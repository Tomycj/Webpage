import { inicializarCells } from "./misFunciones.js";
import { renderShader } from "../shaders/shadersCellsGPU.js";
import { computeShader } from "../shaders/shadersCellsGPU.js";
// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf
// INITIAL VARIABLES
const [device, canvas, canvasFormat, context, timer] = await inicializarCells(); //TODO: ver en misFunciones
let N = 10000; // number of particles
var rng;
const VELOCITY_FACTOR = 0.1;
let frame = 0; // simulation steps
let animationId, paused = true;
const WORKGROUP_SIZE = 64;
const canvasDims = new Float32Array ([canvas.width, canvas.height]);
let elementaries = []; // array donde cada elemento es un array de las partículas de un tipo determinado
let colores = []; // cada elemento es un color, el de cada tipo de part.
let radios = [];  // cada elemento es un radio, el de cada tipo de part.
let nombres = []; // cada elemento es el nombre de cada tipo de part.
let rules = [];   // cada elemento es una regla, formada por un array de 6 números (parámetros de la regla)
let D = []; // diccionario que asocia cada indice de una matriz al indice de cada familia que tenga interacciones
let m = []; // matriz booleana con familias que interaccionan

let updatingParameters = true;
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
		htmlElement.placeholder = seed;
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
		(rng() - 0.5)*VELOCITY_FACTOR
	]);
}
function crearElementary(submission){
	// crea un array de n partículas. Submission es un diccionario como particleCreatorSubmission
	const n = submission.cantidad;
	const particulas = new Array(n);
	rng = new alea(getSeed(seedInput)); // Resetear la seed
	for (let i=0 ; i < n ; i++ ){
		particulas[i] = [randomPosition(), randomVelocity()] // randomPosition es vec4f y randomVel es vec2f
	}
	return particulas;
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
function expandir(m) { // agrega una olumna y fila de ceros a una matriz
	const newFil = Array(m.length).fill(0);
	m.push(newFil);
	m.forEach(fil => fil.push(0));
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
// elegir cantidad de partículas (legacy)
const nPicker = document.getElementById("npicker");
nPicker.onchange = function() { 
	nPicker.value = Math.max(0, nPicker.value);
	nPicker.value = Math.min(nPicker.value, 100000);
	N = nPicker.value;
}
nPicker.oninput = function() { 
	let ancho = nPicker.value.length
	nPicker.style.width = `${ Math.max(ancho, 3) + 2 }ch`;
}
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
// Creador de partículas
const submitElementaryButton = document.getElementById("c.elemsubmit");
const afectaSelector = document.getElementById("targetselect");
const ejercidaSelector = document.getElementById("sourceselect");
const particleSelector = document.getElementById("particleselect");
const c_nom = document.getElementById("c.nom");  
const c_col = document.getElementById("c.col");   
const c_cant = document.getElementById("c.cant"); 
const c_radius = document.getElementById("c.radius"); 

submitElementaryButton.onclick = function(){

	// Validacióm
	if ( !validarNumberInput(c_cant) || !validarNumberInput(c_radius) || ( c_nom.value == "" ) ) {
		return;
	}

	// Una vez validado todo:
	const particleCreatorSubmission = {
		nombre: c_nom.value,					// string
		color: hexString_to_rgba(c_col.value),  // vec4f    (orig. string like "#000000")
		cantidad: parseInt(c_cant.value),		// integer (originalmente string)
		radio: parseFloat(c_radius.value),		// float   (originalmente string)
	}

	if ( nombres.includes(particleCreatorSubmission.nombre) ){
		console.log("Reemplazando partículas del mismo nombre...")

		const i = nombres.indexOf(particleCreatorSubmission.nombre);

		elementaries[i] = ( crearElementary(particleCreatorSubmission) ); //agregar array con posiciones y velocidades
		nombres[i] = (particleCreatorSubmission.nombre);
		colores[i] = (particleCreatorSubmission.color);
		radios[i] = (particleCreatorSubmission.radio);

	} else {
		elementaries.push( crearElementary(particleCreatorSubmission) ); //agregar array con posiciones y velocidades
		nombres.push(particleCreatorSubmission.nombre);
		colores.push(particleCreatorSubmission.color);
		radios.push(particleCreatorSubmission.radio);

		// actualizar lista de nombres en el creador de reglas de interacción
		const option = document.createElement("option");
		option.value = particleCreatorSubmission.nombre;
		option.text = particleCreatorSubmission.nombre;
		afectaSelector.appendChild(option);

		const option2 = option.cloneNode(true);
		ejercidaSelector.appendChild(option2);

		const option3 = option.cloneNode(true);
		particleSelector.appendChild(option3);

	}

	//console.log("Elementaries (todas las partículas):");
	//console.log(elementaries);

}

// Creador de reglas de interacción
const submitRuleButton = document.getElementById("r.submit");
const ruleSelector = document.getElementById("ruleselect");

const r_intens = document.getElementById("r.intens");  
const r_qm = document.getElementById("r.qm");
const r_dmin = document.getElementById("r.dmin");  
const r_dmax = document.getElementById("r.dmax");    


submitRuleButton.onclick = function(){

	// validación
	if ( !validarNumberInput(r_intens) || !validarNumberInput(r_qm) || !validarNumberInput(r_dmin) || !validarNumberInput(r_dmax) ){
		return;
	}

	const targetIndex = afectaSelector.selectedIndex;
	const sourceIndex = ejercidaSelector.selectedIndex;
	const newRule = [
		targetIndex,
		sourceIndex,
		parseFloat(r_intens.value),
		parseFloat(r_qm.value),
		parseFloat(r_dmin.value),
		parseFloat(r_dmax.value),
	];

	rules.push(newRule)

	//  Agregar familias a lista de familias que interactúan, si no lo estaban ya. Activar el par en la matriz triangular booleana de interacciones

	let fil, col;
	if (!includesIn2nd(D,targetIndex)) {
		fil = D.length;
		D.push([fil, targetIndex]);
		expandir(m);
	} else { fil = findIndexOf2nd(D, targetIndex) }

	if (!includesIn2nd(D,sourceIndex)) {
		col = D.length;
		D.push([col, sourceIndex]);
		expandir(m);
	} else { col = findIndexOf2nd(D, sourceIndex) }

	if (fil>col) { // Me aseguro que fil <= col, para trabajar con la matriz triangular superior
		const t = fil;
		fil = col;
		col = t;
	}
	console.log("Índices:");
	console.log(D);
	m[ D[fil][0] ] [ D[col][0] ] ++;
	console.log("Matriz de interacciones:");
	console.log(m); 

	//TODO: Completar proceso de borrado de reglas y/o partículas


	const option = document.createElement("option");
	option.text = `${afectaSelector.options[targetIndex].value} ← ${ejercidaSelector.options[sourceIndex].value}`;
	ruleSelector.appendChild(option);

}

// Rule manager
const borraRuleButton = document.getElementById("borrarule");
borraRuleButton.onclick = function(){
	const indexToDelete = ruleSelector.selectedIndex;
	rules.splice(indexToDelete,1);
	ruleSelector.options[indexToDelete].remove();
}
// Particle manager
const borraParticleButton = document.getElementById("borraparticula");
borraParticleButton.onclick = function(){
	const indexToDelete = particleSelector.selectedIndex;
	elementaries.splice(indexToDelete,1);
	particleSelector.options[indexToDelete].remove();
	afectaSelector.options[indexToDelete].remove();
	ejercidaSelector.options[indexToDelete].remove();
	console.log(elementaries);
	//TODO: Ver qué hacer con las reglas de elementaries borrados
}


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
let bindGroups;
let particleRenderPipeline;

// ARMAR BUFFERS Y PIPELINES


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

	// dimensiones del canvas
	const uniformBuffer = device.createBuffer({
		label: "Particles Uniforms",
		size: canvasDims.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(uniformBuffer, 0, canvasDims);

	// posiciones de las partículas
	const positions = new Float32Array(N*4); // crea un array obj que apunta a la misma memoria que el ArrayBuffer devuelto por .get///
	for (let i = 0; i < N; i++) {
		positions[i * 4 + 0] = (rng() - 0.5)*2*canvas.width;
		positions[i * 4 + 1] = (rng() - 0.5)*2*canvas.height;
		positions[i * 4 + 2] = 0.0;
		positions[i * 4 + 3] = 1.0;
	}

	const positionBuffers = [
		device.createBuffer({
			label: "Positions buffer IN",
			size: positions.byteLength, //N * 4 * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		}),
		device.createBuffer({
			label: "Positions buffer OUT",
			size: positions.byteLength, //N * 4 * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		})
	];
	device.queue.writeBuffer(positionBuffers[0], 0, positions);

	// velocidades de las particulas

	const velocities = new Float32Array(N*2);
	for (let i = 0; i < N; i++) {
		velocities[i * 2 + 0] = (rng() - 0.5)*VELOCITY_FACTOR;
		velocities[i * 2 + 1] = (rng() - 0.5)*VELOCITY_FACTOR;
	}
	const velocityBuffer = device.createBuffer({
		label: "Velocities buffer",
		size: velocities.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(velocityBuffer, 0, velocities);


	// BIND GROUP SETUP
	const bindGroupLayout = device.createBindGroupLayout({
		label: "Particle Bind Group Layout",
		entries: [{
			binding: 0,
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
			buffer: {}  // Grid uniform buffer, el default
		}, {
			binding: 1,
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
			buffer: { type: "read-only-storage" } // Initial state input buffer
		}, {
			binding: 2,
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }	// Final state output buffer (storage = read_write)
		}, {
			binding: 3, //velocidades
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}]
	});

	bindGroups = [
		device.createBindGroup({
			label: "Particle renderer bind group A",
			layout: bindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: uniformBuffer }
			}, {
				binding: 1,
				resource: { buffer: positionBuffers[0] }
			}, {
				binding: 2,
				resource: { buffer: positionBuffers[1] }
			},{
				binding: 3,
				resource: { buffer: velocityBuffer }
			}],
		}),
		device.createBindGroup({
			label: "Particle renderer bind group B",
			layout: bindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: uniformBuffer }
			}, {
				binding: 1,
				resource: { buffer: positionBuffers[1] }
			}, {
				binding: 2,
				resource: { buffer: positionBuffers[0] }
			}, {
				binding: 3,
				resource: { buffer: velocityBuffer }
			}],
		})
	];

	// PIPELINE SETUP

	const pipelineLayout = device.createPipelineLayout({
		label: "Particle Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayout ],
	}); // El orden de los bind group layours tiene que coincider con los atributos @group en el shader

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

	const encoder = device.createCommandEncoder();

	if (timer) {	 // Initial timestamp - before compute pass
		encoder.writeTimestamp(querySet, 0);
	} else {
		t0 = window.performance.now();
	}

	const computePass = encoder.beginComputePass();
	

	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[frame % 2]);

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