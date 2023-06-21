import { inicializarCells } from "./misFunciones.js";
import { renderShader } from "../shaders/shadersCellsGPU.js";
import { computeShader } from "../shaders/shadersCellsGPU.js";
// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf
// INITIAL VARIABLES
const [device, canvas, canvasFormat, context, timer] = await inicializarCells();

/* Forzar color canvas para UI testing
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
ctx.rect(1, 1, 2000, 2000);
ctx.fillStyle = "red";
ctx.fill();
let timer; */

const VELOCITY_FACTOR = 0.1;
const WORKGROUP_SIZE = 64;
const SAMPLE_SETUP = {
	seed: "sampleSeed",
	elementaries: [
		{
			nombre: "sampleName",
			color: [1.0, 2.0, 3.0, 4.0],
			cantidad: 2,
			radio: 2.0,
			posiciones: [],
			velocidades: [],
		},
	],
	rules: [
		{
			ruleName: "sampleName",
			targetName: "sampleName",
			sourceName: "sampleName",
			intensity: 2.0,
			quantumForce: 2.0,
			minDist: 2.0,
			maxDist: 2.0,
		},
	]
}
let N = 0; // number of particles
var rng;
let frame = 0; // simulation steps
let animationId, paused = true;
const canvasDims = new Float32Array ([canvas.width, canvas.height]);
let elementaries = []; // cada elemento es un objeto que almacena toda la info de una familia de parts.
let rules = [];   // cada elemento es una regla, formada por un objeto que la define.
let D = []; // "diccionario" que asocia cada indice de una matriz al indice de cada familia que tenga interacciones.
let m = []; // matriz triangular que codifica las interacciones entre familias.
let bytesDist = []; // bytes ocupados por cada una de las tablas de distancias entre partículas a computar.
let updatingParameters = true;
let resetPositions = true;
let editingBuffers = false;
let stepping = false;
let uiSettings = {
	bgColor : [0, 0, 0, 1],
}

// TIMING & DEBUG -- véase https://omar-shehata.medium.com/how-to-use-webgpu-timestamp-query-9bf81fb5344a
let capacity, querySet, queryBuffer;
let t0, t1, t2;
if (timer) {
	capacity = 3; //Max number of timestamps we can store
	querySet = device.createQuerySet({
		type: "timestamp",
		count: capacity,
	});
	queryBuffer = device.createBuffer({
		size: 8 * capacity,
		usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});
}
async function readBuffer(device, buffer) {
	const size = buffer.size;
	const gpuReadBuffer = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const copyEncoder = device.createCommandEncoder();
	copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);
	const copyCommands = copyEncoder.finish();
	device.queue.submit([copyCommands]);
	await gpuReadBuffer.mapAsync(GPUMapMode.READ);
	return gpuReadBuffer.getMappedRange();
}

// Funciones varias
function getSeed(htmlElement){
	if (htmlElement.value == "") {
		const seed = Math.random().toFixed(7).toString();
		htmlElement.value = seed;
		return seed;
	}
	return htmlElement.value;

}
function hexString_to_rgba(hexString, a){
	
	hexString = hexString.replace("#",""); // remove possible initial #

	const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
    const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
    const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

	// console.log(`Returned RGBA array [${[red, green, blue, a]}] from "#${hexString}" [hexString_to_rgba] `);

    return new Float32Array([red, green, blue, a]); // Store the RGB values in an array
}
function randomPosition(margin=0){
	return new Float32Array([
		(rng() - 0.5)*canvas.width,
		(rng() - 0.5)*canvas.height,
		0,
		1
	]);
}
function randomVelocity(){
	return new Float32Array([
		(rng() - 0.5)*VELOCITY_FACTOR,
		(rng() - 0.5)*VELOCITY_FACTOR,
		0
	]);
}
function crearPosiVel(n){

	rng = new alea(getSeed(seedInput)); // Resetear la seed

	const buffer = new ArrayBuffer(n * 7 * 4) // n partículas, cada una tiene 28B (4*4B para la pos y 3*4B para la vel)

	const pos = new Float32Array(buffer, 0, n*4); // buffer al que hace referencia, byte offset, number of elements. [x1, y1, z1, w1, x2, y2, ...]
	const vel = new Float32Array(buffer, n*4*4, n*3);

	for (let i=0 ; i < n*4 ; i += 4) {
		[ pos [i], pos[i+1], pos [i+2], pos[i+3] ] = randomPosition() // randomPosition devuelve un array [x,y,z,w]
	}

	for (let i=0 ; i < n*3 ; i += 3) {
		[ vel [i], vel[i+1], vel [i+2] ] = randomVelocity() // randomVelocity devuelve un array [x,y,]
	}

	return [pos, vel]
}
function validarNumberInput(input){
	// input es un objeto representando un html element input de type number
	const val = parseInt(input.value);
	const min = parseInt(input.min);
	const max = parseInt(input.max);

	if ( val < min || val > max || isNaN(val) ){
		console.log(`Entrada inválida: ${input.id}`);
		return false;
	}
	return true;

}
function includesIn2nd(array, num){ // busca num entre el 2do elemento de los subarrays dentro de array
	return array.some(subarray => subarray[1] == num);
}
function findIndexOf2nd(array, num){ // devuelve el índice del subarray que cumple includesIn2nd
	return array.findIndex(subarray => subarray[1] == num);
}
function expandir(m) { // agrega una columna y fila de ceros a una matriz
	const newFil = Array(m.length).fill(0);
	m.push(newFil);
	m.forEach(fil => fil.push(0));
}
function matrizDistancias(rule) { // actualiza la matriz triangular de interacciones con la regla proporcionada

	const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.targetName});
	const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.sourceName});
	
	/*	Agregar familias a lista D de familias que interactúan de alguna forma, si no lo estaban ya.
	*	La lista D también asocia cada familia interactuante (su índice en la lista de los selectores) 
	*	con su índice en la matriz de interacciones.
	*/
	let a, b;
	if (!includesIn2nd(D,targetIndex)) {
		// Nueva familia que tendrá interacciones
		a = D.length;
		D.push([a, targetIndex, rule.targetName]);
		expandir(m);
	} else { a = findIndexOf2nd(D, targetIndex) }

	if (!includesIn2nd(D,sourceIndex)) {
		// Nueva familia que tendrá interacciones
		b = D.length;
		D.push([b, sourceIndex, rule.sourceName]);
		expandir(m);
	} else { b = findIndexOf2nd(D, sourceIndex) }

	if (a>b) { // Me aseguro que a <= b, para trabajar con la matriz triangular superior
		const temp = a;
		a = b;
		b = temp;
	}
	//console.table(D);

	// Agregar la nueva interacción a la matriz triangular de interacciones (Se le suma 1 a la casilla correspondiente)

	const fil = D[a][0];
	const col = D[b][0];
	m[ fil ] [ col ] ++;
	//console.table(m);

	// Si es una interacción nueva, habrá que añadir al buffer espacio para esas distancias
	if (m[fil][col] == 1) {
		//console.log("Interacción nueva");
		const nTargets = elementaries[targetIndex].posiciones.length / 4;	// cantidad de partículas de la familia target
		const nSources = elementaries[sourceIndex].posiciones.length / 4;

		bytesDist.push(nTargets * nSources * 4); // 4 bytes (1 float, 1 distancia) por cada par target-source.

	}

}
function crearElementary(nombre, color, cantidad, radio, posiciones, velocidades) {
	if ( 
		typeof nombre === "string" && 
		color.constructor === Float32Array && color.length === 4 &&
		Number.isInteger(cantidad) && cantidad > 0 &&
		typeof radio === "number" && radio > 0  &&
		posiciones.constructor === Float32Array && 
		velocidades.constructor === Float32Array
	) {
		return {
			nombre,			// string
			color,  		// vec4f    (orig. string like "#000000")
			cantidad,		// integer (originalmente string)
			radio,			// float   (originalmente string)
			posiciones,		// [x,y,z,w]
			velocidades,	// [x,y,z]
		};
	}

	throw new Error("Detectado parámetro inválido");

}
function cargarElementary(newElementary) {  // añade una familia a la lista.
	if ( elementaries.some(dict => dict.nombre == newElementary.nombre) ){
		console.log("Reemplazando partículas del mismo nombre...")
		const i = elementaries.findIndex(dict => dict.nombre == newElementary.nombre);
		elementaries [i] = newElementary;

	} else {
		elementaries.push( newElementary );
		// actualizar lista de nombres en el creador de reglas de interacción
		actualizarElemSelectors(newElementary);
	}
}
function exportarElementary(elementary) {

	elementary.posiciones = Array.from(elementary.posiciones);
	elementary.velocidades = Array.from(elementary.velocidades);

	const jsonString = JSON.stringify(elementary, null, 2);

	const blob = new Blob([jsonString], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	
	const a = document.createElement("a");
	a.href = url;
	a.download = elementary.nombre;
	document.body.appendChild(a);
	a.click();
	
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
function exportarSetup(elementaries, rules, seed, filename = "Cells GPU setup", full = false) {

	if (full) {
		for (let elem of elementaries) {
			elem.posiciones = Array.from(elem.posiciones);
			elem.velocidades = Array.from(elem.velocidades);
			elem.color = Array.from(elem.color);
		}
	} else {
		for (let elem of elementaries) {
			elem.posiciones = [];
			elem.velocidades = [];
			elem.color = Array.from(elem.color);
		}
	}
	

	const setup = { seed, elementaries, rules};
	const jsonString = JSON.stringify(setup, null, 2);

	const blob = new Blob([jsonString], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

}
function importarSetup() {
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = ".json"
	return new Promise((resolve, reject) => {
	fileInput.addEventListener('change', (event) => {
		const file = event.target.files[0];
		const reader = new FileReader();

		reader.onload = () => {
		try {
			const jsonData = JSON.parse(reader.result);
			resolve(jsonData);
		} catch (error) {
			reject(error);
		}
		};

		reader.onerror = (error) => {
		reject(error);
		};

		reader.readAsText(file);
	});

	fileInput.click();
	});
}
function cargarSetup(setup) {  // reemplaza el setup actual.
	if (!hasSameStructure(setup, SAMPLE_SETUP)) { throw new Error("Falló la verificación, no es un objeto tipo setup")}

	vaciarSelectors();
	for (let elem of setup.elementaries) {
		actualizarElemSelectors(elem);
		const [pos, vel] = crearPosiVel(elem.cantidad);
		elem.posiciones = pos;
		elem.velocidades = vel;
	}
	for (let rule of setup.rules) {
		actualizarRuleSelector(rule);
	}
	seedInput.value = setup.seed;
	rules = setup.rules;
	elementaries = setup.elementaries;
	
}
function hasSameStructure(obj1, obj2) { // no revisa la estructura de los arrays de elementaries y rules TODO: se puede mejorar
	const keys1 = Object.keys(obj1).sort();
	const keys2 = Object.keys(obj2).sort();

	if (keys1.length !== keys2.length) {
		return false;
	}

	for (let i = 0; i < keys1.length; i++) {
		const key1 = keys1[i];
		const key2 = keys2[i];

		if (key1 !== key2 || typeof obj1[key1] !== typeof obj2[key2]) {
			return false;
		}

		if (typeof obj1[key1] === "object" && !Array.isArray(obj1[key1])) {

			if (!hasSameStructure(obj1[key1], obj2[key2])) {
				return false;
			}
		}
	}
	return true;
}
function removeChilds(htmlElement) {
	while (htmlElement.firstChild) {
		htmlElement.removeChild(htmlElement.firstChild);
	}
}
function vaciarSelectors(){
	removeChilds(partiControls.selector);
	removeChilds(ruleControls.selector);
	removeChilds(ruleControls.targetSelector);
	removeChilds(ruleControls.sourceSelector);
}
function actualizarElemSelectors(elementary) {
	const option = document.createElement("option");

	option.value = elementary.nombre;
	option.text = elementary.nombre;

	ruleControls.targetSelector.appendChild(option);

	const option2 = option.cloneNode(true);
	ruleControls.sourceSelector.appendChild(option2);

	const option3 = option.cloneNode(true);
	partiControls.selector.appendChild(option3);
}
function actualizarRuleSelector(rule) {
	const option = document.createElement("option");
	option.text = rule.ruleName;
	ruleControls.selector.appendChild(option);
}
function crearRule(ruleName, targetName, sourceName, intensity, quantumForce, minDist, maxDist) {

	if (!ruleName) { ruleName = `${targetName} ← ${sourceName}`; }

	return {
		ruleName,
		targetName,
		sourceName,
		intensity,
		quantumForce,
		minDist,
		maxDist,
	} 
}
function generarSetupClásico() {
	const e = new Float32Array([]);
	const elementaries = [
		crearElementary("yellow", new Float32Array([1,1,0,1]), 300, 3, e, e),
		crearElementary("red", new Float32Array([1,0,0,1]), 80, 4, e, e),
		crearElementary("purple", new Float32Array([147/255,112/255,219/255,1]), 30, 5, e, e),
		crearElementary("green", new Float32Array([0,128/255,0,1]), 5, 7, e, e),
	];
	
	const rules = [
		crearRule("","red","red", 0.5, 0.2, 15, 100), 		// los núcleos se tratan de juntar si están cerca
		crearRule("","yellow","red", 0.5, 0, 60, 600), 		// los electrones siguen a los núcleos, pero son caóticos
		crearRule("","yellow","yellow", -0.1, 1, 20, 600),
		crearRule("","purple","red", 0.4, 0, 0.1, 150), 	// los virus persiguen a los núcleos
		crearRule("","purple","yellow", -0.2, 1, 0.1, 100), // los virus son repelidos por los electrones
		crearRule("","yellow","purple", 0.2, 0, 0.1, 100), 	// los electrones persiguen a los virus
		crearRule("","red","purple", 1, 1, 0.1, 10), 		// los virus desorganizan los núcleos
		crearRule("","red","green", 0.3, 0, 50, 1000), 		// los núcleos buscan comida
		crearRule("","green","green", -0.2, 0.2, 50, 500), 	// la comida se mueve un poco y estabiliza las células
	];
	const seed = "";
	const setup = {seed, elementaries, rules};
	cargarSetup(setup)
	console.log("Setup clásico cargado!")
}

// EVENT HANDLING

// panel de info
document.getElementById("canvasinfo").innerText = `${canvas.width} x ${canvas.height} (${canvas.width/canvas.height})`;
const displayTiming = document.getElementById("performanceinfo");
// ocultar interfaces
const panelTitle = document.getElementById("controlPanelTitle");
const cpOptions = document.getElementById("controlPanelOptions");
panelTitle.onclick = function() { 
	cpOptions.hidden ^= true;
	if (cpOptions.hidden){ panelTitle.style = "height: 3ch;"; } else { panelTitle.style = ""; }
}
const creadorPartTitle = document.getElementById("creadorparticulasTitle");
creadorPartTitle.onclick = function () {document.getElementById("creadorparticulas").hidden ^= true;}
const creadorReglasTitle = document.getElementById("creadorreglasTitle");
creadorReglasTitle.onclick = function () {document.getElementById("creadorreglas").hidden ^= true;}
// seed input
const seedInput = document.getElementById("seed");
// canvas color
const bgColorPicker = document.getElementById("bgcolorpicker");
bgColorPicker.onchange = function() { uiSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1); }
// botón de pausa
const pauseButton = document.getElementById("pausebutton");
pauseButton.onclick = function() { 
	
	if (!paused) {
		pauseButton.innerText = "Resumir";
		cancelAnimationFrame(animationId);
	} else {
		paused = true;
		pauseButton.innerText = "Pausa";
		animationId = requestAnimationFrame(newFrame);
	}
	paused = !paused;
	stepping = false;
	resetButton.hidden = false;

}
// botón de reset
const resetButton = document.getElementById("resetbutton");
resetButton.onclick = function() { updatingParameters = true;}
// botón de frame
const stepButton = document.getElementById("stepbutton");
stepButton.onclick = function() { 
	stepping = true;
	paused = true;
	animationId = requestAnimationFrame(newFrame);
	pauseButton.innerText = "Resumir";
	resetButton.hidden = false;
}
// botón de info debug
const infoButton = document.getElementById("mostrarinfo");
infoButton.onclick = function() { document.getElementById("infopanel").hidden ^= true; }
// botón de export e import
const exportButton = document.getElementById("export");
const importButton = document.getElementById("import");
exportButton.onclick = function() { exportarSetup(elementaries, rules, seedInput.value); }
importButton.onclick = function() {
	importarSetup()
	.then((setup) =>{ cargarSetup(setup) })
	.catch((error) => {
		window.alert("Error, archivo descartado");
		console.error(error);
	});
}

// Creador de partículas
const ruleControls = {
	nameInput: document.getElementById("rulename"),
	targetSelector: document.getElementById("targetselect"),
	sourceSelector: document.getElementById("sourceselect"),
	intens: document.getElementById("r.intens"),
	qm: document.getElementById("r.qm"),
	dmin: document.getElementById("r.dmin"),
	dmax: document.getElementById("r.dmax"),
	selector: document.getElementById("ruleselect"),
	submitButton: document.getElementById("r.submit"),
}
const partiControls = {
	nameInput: document.getElementById("c.nom"),
	colorInput: document.getElementById("c.col"),
	cantInput: document.getElementById("c.cant"),
	radiusInput:document.getElementById("c.radius"),
	selector: document.getElementById("particleselect"),
	submitButton: document.getElementById("c.elemsubmit"),
}

partiControls.submitButton.onclick = function(){

	// Validacióm
	if ( !validarNumberInput(partiControls.cantInput) || !validarNumberInput(partiControls.radiusInput) || ( partiControls.nameInput.value == "" ) ) {
		return;
	}

	// Una vez validado todo:
	const cant = parseInt(partiControls.cantInput.value);
	const [pos, vel] = crearPosiVel(cant);

	cargarElementary( crearElementary(
		partiControls.nameInput.value,
		hexString_to_rgba(partiControls.colorInput.value, 1),
		cant,
		parseFloat(partiControls.radiusInput.value),
		pos,
		vel,
	));

	//console.log(elementaries);

}

// Creador de reglas de interacción
ruleControls.submitButton.onclick = function(){

	// validación
	if ( !validarNumberInput(ruleControls.intens) || !validarNumberInput(ruleControls.qm) || 
		 !validarNumberInput(ruleControls.dmin) || !validarNumberInput(ruleControls.dmax) ){
		return;
	}

	const targetIndex = ruleControls.targetSelector.selectedIndex;
	const sourceIndex = ruleControls.sourceSelector.selectedIndex;
	let newRuleName = ruleControls.nameInput.value;

	if (!newRuleName) { // Si el campo del nombre está vacío, usa el nombre estándar
		newRuleName = `${ruleControls.targetSelector.options[targetIndex].value} ← ${ruleControls.sourceSelector.options[sourceIndex].value}`;
	}

	while (rules.some(rule => rule.ruleName == newRuleName)) { // Mientras sea nombre repetido, añade (n)

		if (/\(\d+\)$/.test(newRuleName)) {
			newRuleName = newRuleName.replace(/\((\d+)\)$/, (_, number) => {
				return "(" + (parseInt(number) + 1) + ")";
			});

		} else {
			newRuleName += " (1)";
		}
	}
	
	const newRule = crearRule(
		newRuleName,
		ruleControls.targetSelector.value,
		ruleControls.sourceSelector.value,
		parseFloat(ruleControls.intens.value),
		parseFloat(ruleControls.qm.value),
		parseFloat(ruleControls.dmin.value),
		parseFloat(ruleControls.dmax.value),
	);

	//console.log(newRule);
	rules.push(newRule)

	// Agregar regla al selector de reglas.
	actualizarRuleSelector(newRule);

	/*

	// Si es una regla activa (si incluye partículas con nombres existentes), hay que agregar la interacción.
	// aquí siempre va a ser una regla activa porque sólo se pueden crear reglas entre partículas existentes.

	let esReglaActiva = elementaries.some(dict => dict.nombre == newRule.targetName) && elementaries.some(dict => dict.nombre == newRule.sourceName) 

	if (esReglaActiva) {
		//	Agregar familias a lista D de familias que interactúan de alguna forma, si no lo estaban ya.
		//	La lista D también asocia cada familia interactuante (su índice en la lista de los selectores) 
		//	con su índice en la matriz de interacciones.
		
		let a, b;
		if (!includesIn2nd(D,targetIndex)) {
			// Nueva familia que tendrá interacciones
			a = D.length;
			D.push([a, targetIndex, ruleControls.targetSelector.value]);
			expandir(m);
		} else { a = findIndexOf2nd(D, targetIndex) }

		if (!includesIn2nd(D,sourceIndex)) {
			// Nueva familia que tendrá interacciones
			b = D.length;
			D.push([b, sourceIndex, ruleControls.sourceSelector.value]);
			expandir(m);
		} else { b = findIndexOf2nd(D, sourceIndex) }

		if (a>b) { // Me aseguro que a <= b, para trabajar con la matriz triangular superior
			const temp = a;
			a = b;
			b = temp;
		}
		//console.table(D);

		// Agregar la nueva interacción a la matriz triangular de interacciones (Se le suma 1 a la casilla correspondiente)

		const fil = D[a][0];
		const col = D[b][0];
		m[ fil ] [ col ] ++;
		//console.table(m); 

		// Si es una interacción nueva, habrá que añadir al buffer espacio para esas distancias
		if (m[fil][col] == 1) {
			//console.log("Interacción nueva");
			const nTargets = elementaries[targetIndex].length;	// 4 bytes (1 float) por cada partícula de la flia target
			const nSources = elementaries[sourceIndex].length;	// 4 bytes (1 float) por cada partícula de la flia source

			bytesDist.push(nTargets * nSources * 4); // 4 bytes (1 float, 1 distancia) por cada par target-source.
		}
	}

	*/


	/* TODO: Completar proceso de borrado de reglas y/o partículas. Al borrar una regla hay que actualizar elementaries, 
	D, m, bytesDist...
	* Alternativa: usar una sparse matrix y listo
	*/

}

// Rule manager
const borraRuleButton = document.getElementById("borrarule");
borraRuleButton.onclick = function(){
	const indexToDelete = ruleControls.selector.selectedIndex;
	rules.splice(indexToDelete,1);
	ruleControls.selector.options[indexToDelete].remove();
}
// Particle manager
const borraParticleButton = document.getElementById("borraparticula");
borraParticleButton.onclick = function(){
	const indexToDelete = partiControls.selector.selectedIndex;
	elementaries.splice(indexToDelete,1);
	partiControls.selector.options[indexToDelete].remove();
	ruleControls.targetSelector.options[indexToDelete].remove();
	ruleControls.sourceSelector.options[indexToDelete].remove();
	//console.log(elementaries);
	
	// TODO: actualizar reglas activas y buffers si hace falta
}


generarSetupClásico();

// VERTEX SETUP

const ar = canvas.width / canvas.height; // Canvas aspect ratio

const vertices = new Float32Array([
	//   X,    Y,
	-1, -1, // Triangle 1 (Blue)
	1, -1,
	1,  1,

	-1, -1, // Triangle 2 (Red)
	1,  1,
	-1,  1,
]);
const vertexBuffer = device.createBuffer({
	label: "Particle vertices",
	size: vertices.byteLength, //12 * 32-bit floats (4 bits c/u) = 48 bytes
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);

const vertexBufferLayout = {
	arrayStride: 8, 					// cada vertex ocupa 8 bytes (2 *4-bytes)
	attributes:[{ 						// array que es un atributo que almacena cada vertice (BLENDER!!!)
		format: "float32x2", 			// elijo el formato adecuado de la lista de GPUVertexFormat
		offset: 0, 						// a cuántos bytes del inicio del vertice empieza este atributo.
		shaderLocation: 0, 				// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
	}]
};

let simulationPipeline;
let bindGroups = [];
let particleRenderPipeline;

// ARMAR BUFFERS Y PIPELINES

let positionBuffers = [];
let velocitiesBuffer = [];

function editBuffers(resetPosiVels) {

	const Ne = elementaries.length;
	N = 0;
	for (let elementary of elementaries) { N += elementary.cantidad; }

	// Colores, radios y canvas
	const colsYRads = new ArrayBuffer(Ne*5*4 + 8 + 4); 			// Ne*4 colores + Ne*1 radios, cada uno de éstos tiene 4 bytes. 8 bytes para los 2 límites

	const cantParticulas = new Float32Array(colsYRads, 0, 1);
	cantParticulas.set([N]);
	const canvasDims = new Float32Array(colsYRads, 4, 2); 	// canvasDims. Podría hacerse aparte si hace falta.
	canvasDims.set([canvas.width, canvas.height]);
	const colores = new Float32Array(colsYRads, 4 + 8,  Ne*4);				// 4 elementos por cada color: [R1 G1 B1 A1, R2, G2, B2, A2, ...]
	const radios = new Float32Array(colsYRads, 4 + 8 + Ne*4*4, Ne);			// byte offset de 16Ne, Ne radios: [r1, r2, r3, ...]

	const colsYRadsArray = new Float32Array(colsYRads); // F32Array que referencia al buffer

	for (let i=0; i < Ne ; i++) { // Llenar los arrays de colores y radios
		colores.set(elementaries[i].color, i*4);
		radios.set(elementaries[i].radio, i)
	}

	const uniformBuffer = device.createBuffer({
		label: "Colores, radios y canvasDims",
		size: colsYRadsArray.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(uniformBuffer, 0, colsYRadsArray)

	// Distancias

	// genero la lista de matrices de distancias? capaz en la gpu eso
	D = [];
	m = [];
	bytesDist = [];
	let reglasActivas = [];

	for (let rule of rules) {
		//verificar si esta regla está en uso (ambos target y source tienen que estar en elementaries)
		const esReglaActiva = elementaries.some(elem => elem.nombre == rule.targetName) && elementaries.some(elem => elem.nombre == rule.sourceName)

		if ( !esReglaActiva ) { continue; }
		// si es una regla "activa":
		reglasActivas.push(rule);
		matrizDistancias(rule);
		
	}
	console.log(bytesDist)
	console.table(m); 
	console.table(D);

	//const distanciasArray = new Float32Array()

	const distanciasBuffer = device.createBuffer({
		label: "Distancias",
		size: bytesDist.reduce((a, b) => a + b, 0), // suma de todos los bytes de cada una de las matrices distancia
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // storage porque entre cada frame las distancias cambian
	});
	//device.queue.writeBuffer(distanciasBuffer, 0, distanciasArray); // veo si puedo pasar el buffer vacío para rellenarlo en GPU.

	// Reglas

	const rulesArray = new Float32Array(reglasActivas.length * 6);

	for (let i = 0; i < reglasActivas.length; i++) { // llenar el array de reglas
		rulesArray.set([
			reglasActivas[i].targetIndex, // índice de elementary en elementaries
			reglasActivas[i].sourceIndex,
			reglasActivas[i].intensity,
			reglasActivas[i].quantumForce,
			reglasActivas[i].minDist,
			reglasActivas[i].maxDist,
		], 6*i)
	}

	const reglasBuffer = device.createBuffer({
		label: "Reglas",
		size: rulesArray.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(reglasBuffer, 0, rulesArray)

	// Posiciones y velocidades

	if (resetPositions) {
		let posBytes = 0;
		for (let elementary of elementaries) { posBytes += elementary.posiciones.byteLength; } // bytesize de todas las posiciones
		const positionsArrBuffer = new ArrayBuffer(posBytes);
		const velocitiesArrBuffer = new ArrayBuffer(posBytes*3/4);
		const positionsArray = new Float32Array(positionsArrBuffer);
		const velocitiesArray = new Float32Array(velocitiesArrBuffer);

		let offsetPos = 0, offsetVel = 0;
		for (let elementary of elementaries) { // llenar los arrays de posiciones y velocidades

			positionsArray.set(elementary.posiciones, offsetPos);
			velocitiesArray.set(elementary.velocidades, offsetVel)
			offsetPos += elementary.posiciones.length;
			offsetVel += elementary.velocidades.length;

		}

		positionBuffers = [
			device.createBuffer({
				label: "Positions buffer IN",
				size: positionsArray.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			}),
			device.createBuffer({
				label: "Positions buffer OUT",
				size: positionsArray.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			})
		];
		device.queue.writeBuffer(positionBuffers[0], 0, positionsArray);

		velocitiesBuffer = device.createBuffer({
			label: "Velocities buffer",
			size: velocitiesArray.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(velocitiesBuffer, 0, velocitiesArray);

		resetPositions = false;
	}

	return {
		positionBuffers,
		velocitiesBuffer,
		uniformBuffer, 
		distanciasBuffer,
		reglasBuffer,
	}
}

function updateSimulationParameters(){

	console.log("Updating simulation parameters...");
	const rng = new alea(getSeed(seedInput)); // Resetear seed

	// SHADER SETUP

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader(),
	});

	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader(WORKGROUP_SIZE, N),
	})

	// CREACIÓN DE BUFFERS
	const GPUBuffers = editBuffers(true); // diccionario con todos los buffers
	console.log(GPUBuffers)

	// BIND GROUP SETUP
	const bindGroupLayoutPos = device.createBindGroupLayout({
		label: "Positions Bind Group Layout",
		entries: [{
			binding: 0, // entrada
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 1, // salida
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}]
	});

	const bindGroupLayoutResto = device.createBindGroupLayout({
		label: "Resto Bind Group Layout",
		entries: [{
			binding: 0, // colores, radios y canvas
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
			buffer: {}
		}, {
			binding: 1, // velocidades
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" } // Initial state input buffer
		}, {
			binding: 2, // reglas
			visibility: GPUShaderStage.COMPUTE,
			buffer: {}
		}, {
			binding: 3, // distancias
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}]
	});

	bindGroups = [
		device.createBindGroup({ // posiciones A
			label: "Particle positions bind group A",
			layout: bindGroupLayoutPos,
			entries: [{
				binding: 0,
				resource: { buffer: GPUBuffers.positionBuffers[0] }
			}, {
				binding: 1,
				resource: { buffer: GPUBuffers.positionBuffers[1] }
			}],
		}),
		device.createBindGroup({ // posiciones B
			label: "Particle positions bind group B",
			layout: bindGroupLayoutPos,
			entries: [{
				binding: 0,
				resource: { buffer: GPUBuffers.positionBuffers[1] }
			}, {
				binding: 1,
				resource: { buffer: GPUBuffers.positionBuffers[0] }
			}],
		}),
		device.createBindGroup({ // el resto de bind groups
			label: "Resto bind group",
			layout: bindGroupLayoutResto,
			entries: [{
				binding: 0,
				resource: { buffer: GPUBuffers.uniformBuffer } // colores, radios y canvas
			}, {
				binding: 1,
				resource: { buffer: GPUBuffers.velocitiesBuffer }
			}, {
				binding: 2,
				resource: { buffer: GPUBuffers.reglasBuffer }
			}, {
				binding: 3,
				resource: { buffer: GPUBuffers.distanciasBuffer }
			}],
		})
	];

	// PIPELINE SETUP

	const pipelineLayout = device.createPipelineLayout({
		label: "Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto ],
	}); // El orden de los bind group layouts tiene que coincider con los atributos @group en el shader

	// Crear una render pipeline (para usar vertex y fragment shaders)
	particleRenderPipeline = device.createRenderPipeline({
		label: "Particle render pipeline",
		layout: pipelineLayout,
		vertex: {
			module: particleShaderModule,
			entryPoint: "vertexMain",
			buffers: [vertexBufferLayout]
		},
		fragment: {
			module: particleShaderModule,
			entryPoint: "fragmentMain",
			targets: [{
				format: canvasFormat
			}]
		}
	});

	// COMPUTE PIPELINE 
	simulationPipeline = device.createComputePipeline({
		label: "Simulation pipeline",
		layout: pipelineLayout,
		compute: {
			module: simulationShaderModule,
			entryPoint: "computeMain",
			constants: { // es una entrada opcional, acá puedo poner valores que usará el compute shader
				//constante: 1, // Así paso el workgroup size al compute shader
			},
		},
	});
}

const renderPassDescriptor = {	//Parámetros para el render pass que se ejecutará cada frame
	colorAttachments: [{		// es un array, de momento sólo hay uno, su @location en el fragment shader es entonces 0
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: uiSettings.bgColor,
		storeOp: "store",
	}]
};

// Lo que sigue es rendering (y ahora compute) code, lo pongo adentro de una función para loopearlo

async function newFrame(){

	if ( updatingParameters ){	// Rearmar buffers y pipeline
		frame = 0;
		updateSimulationParameters();
		console.log("updated!");
		updatingParameters = false;
	}

	if ( editingBuffers ) {
		editBuffers();
		editingBuffers = false;
	}

	const encoder = device.createCommandEncoder();

	if (timer) {	 // Initial timestamp - before compute pass
		encoder.writeTimestamp(querySet, 0);
	} else { t0 = window.performance.now(); }

	const computePass = encoder.beginComputePass();
	
	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[frame % 2]); // posiciones alternantes
	computePass.setBindGroup(1, bindGroups[2]); // lo demás

	/* El compute shader se ejecutará N veces. El workgroup size es 64, entonces despacho ceil(N/64) workgroups, todos en el eje x. */

	const workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, 1, 1); // Este vec3<u32> tiene su propio @builtin en el compute shader.

	computePass.end();

	if (timer) {	 // Timestamp - after compute pass
		encoder.writeTimestamp(querySet, 1);
	} else {
		t1 = window.performance.now();
	}
	
	frame++;
	
	// Iniciar un render pass (que usará los resultados del compute pass)
	
	renderPassDescriptor.colorAttachments[0].clearValue = uiSettings.bgColor; // Actualizar color de fondo.
	renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
	const pass = encoder.beginRenderPass(renderPassDescriptor);

	pass.setPipeline(particleRenderPipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setBindGroup(0, bindGroups[frame % 2]);		
	
	pass.draw(vertices.length /2, N);	// 6 vertices. renderizados n^2 veces


	pass.end(); // finaliza el render pass

	if (timer) {	 // Timestamp - after render pass
		encoder.writeTimestamp(querySet, 2);
		encoder.resolveQuerySet(
			querySet, 
			0, // index of first query to resolve 
			capacity, //number of queries to resolve
			queryBuffer, 
			0); // destination offset
	} else {
		t2 = window.performance.now();
	}

	device.queue.submit([encoder.finish()]);

	t2 = window.performance.now();
	if (frame % 60 == 0) {	// Leer el storage buffer y mostrarlo en debug info (debe estar después de encoder.finish())

		let dif1, dif2, text = "";
		if (timer) {
			const arrayBuffer = await readBuffer(device, queryBuffer);
			const timingsNanoseconds = new BigInt64Array(arrayBuffer);
			dif1 = Number(timingsNanoseconds[1]-timingsNanoseconds[0])/1_000_000;
			dif2 = Number(timingsNanoseconds[2]-timingsNanoseconds[1])/1_000_000;
		} else {
			dif1 = (t1 - t0).toFixed(4);
			dif2 = (t2 - t1).toFixed(4);
			text +="⚠ GPU Timing desact.\n"
		}
		text += `Compute: ${dif1} ms\nDraw: ${dif2} ms`
		if (dif1+dif2 > 30) {
			text = text + "\nGPU: Brrrrrrrrrrr";
		}
		displayTiming.innerText = text;

	}

	if ( !stepping ){	// Iniciar nuevo frame
		animationId = requestAnimationFrame(newFrame);
	}
}

// Preparar updateGrid para ejecutarse repetidamente

if (!paused){
	animationId = requestAnimationFrame(newFrame);
}
//setInterval(updateGrid, UPDATE_INTERVAL);


//TODO:
/* exportar e importar json con partículas y reglas */