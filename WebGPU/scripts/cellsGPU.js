import { inicializarCells, autoCanvasDims } from "inicializar-webgpu";
import { renderShader, computeShader, computeDistancesShader } from "shaders";

// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf

const 
SHOW_TITLE = false,

[device, canvas, canvasFormat, context, timerDeprecated] = await inicializarCells(SHOW_TITLE),
timer = false, // provisional
SETUPS_FOLDER = "../../data/",
WORKGROUP_SIZE = 64,
NEW_USER = localStorage.getItem("NEW_USER"),
CURRENT_VERSION = document.getElementById("title").innerText,
LAST_VISITED_VERSION = localStorage.getItem("STORED_VERSION_NUMBER"),
CHANGELOG = `\
	${CURRENT_VERSION}

	* El sistema para poner partículas manualmente está oficialmente completado, aunque en el futuro podría\
	pulirse o ampliarse su funcionalidad (ej: arrastrar para dibujar un trazo de muchas partículas).

	* Mejoras en la interfaz y la funcionalidad. Algunas son:\
	\n   + Ahora se puede cambiar, exportar e importar el tamaño del canvas.\
	\n   + El color del canvas ahora se puede cambiar "en tiempo real".
	
	* Corregido un bug relevante al borrar partículas y aplicar reglas.

	* Enormes cambios en la organización del código, está más presentable y mantenible pero falta.\
	Uso de Clases para algunos elementos. 

	* Algunos setups para importar y probar: https://github.com/Tomycj/Webpage/tree/main/data

`,
particleStyles = [
	{
		borderWidth: 1,
		spherical: 0
	}, {
		borderWidth: 0.85,
		spherical: 0
	}, {
		borderWidth: 1,
		spherical: 1
	}
],
styleSettings = {
	bgColor: [0, 0, 0, 1],
	//particleStyle: [1, 1], //[borderStart in UV scale (0-1), is spherical?]
	particleStyle: particleStyles[2],
},
ambient = {
	friction: 1 - 0.995, // 0.995 en el shader
	bounce: 80, // 0.8 en el shader
	maxInitVel: 0,
	canvasDims: [canvas.width, canvas.height],
},
flags = {
	updateSimParams: true,
	resetParts: false,
	updateParticles: false,
	updateRules: false,

	rulesModified: false, // Se modificaron las reglas en la UI.

	editAmbient: false,
	editPStyle: true,

	justLoadedSetup: false,
};

let 
N = 0, 	// Cantidad total de partículas
Nd = 0, // Cantidad total de distancias a precalcular (si habilitado)
elementaries = [],	// Array de familias de partículas (clase Elementary)
rules = [],			// Array de reglas de interacción (clase Rule)
workgroupCount,		// workgroups para ejecutar las reglas de interacción (mover las partículas)
workgroupCount2, 	// worgroups para calcular distancias entre partículas
rng,
frame = 0,
animationId,
paused = true,
stepping = false,
listaInteracciones = [],
awaitingResetCall = false,
muted = false,
fps = 0,
frameCounter = 0,
refTime,
placePartOnClic = false,
mouseIsDown = false,
mDownX = 0, mDownY = 0,
newParticles = [], // PosiVels de partículas creadas manualmente para cada elementary
sampleCount = 1, // Parece que sólo puede ser 1 o 4.
textureView;

// TIMING & DEBUG 
	const STARTING_SETUP_NUMBER = 1,
	SETUP_FILENAME = "Cells GPU setup - ClassicX10",
	SHOW_DEBUG = false;
	//localStorage.setItem("NEW_USER", 1);
	//localStorage.setItem("STORED_VERSION_NUMBER", -1);
	let PRECALCULAR_DISTANCIAS = false;
	let capacity = 4; //Max number of timestamps 
	let t = [];
	let querySet, queryBuffer;

	if (timer) { // véase https://omar-shehata.medium.com/how-to-use-webgpu-timestamp-query-9bf81fb5344a
		querySet = device.createQuerySet({
			type: "timestamp",
			count: capacity,
		});
		queryBuffer = device.createBuffer({
			size: 8 * capacity,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});
	}
//

// FUNCIONES VARIAS Y CLASES - TODO: Modularizar

	// General utility
	function hexString_to_rgba(hexString, a) {
		
		hexString = hexString.replace("#",""); // remove possible initial #

		const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
		const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
		const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

		// console.log(`Returned RGBA array [${[red, green, blue, a]}] from "#${hexString}" [hexString_to_rgba] `);

		return new Float32Array([red, green, blue, a]); // Store the RGB values in an array
	}
	function randomPosition(elementaryIndex, margin = 0) {
		return ([
			(rng() - 0.5) * (ambient.canvasDims[0] - margin), // TODO: así como está es eficiente pero el margen no es el esperado
			(rng() - 0.5) * (ambient.canvasDims[1] - margin),
			0,
			elementaryIndex
		]);
	}
	function randomVelocity() {
		return ([
			(2 * rng() - 1) * ambient.maxInitVel,
			(2 * rng() - 1) * ambient.maxInitVel,
			0,
			1,
		]);
	}
	function crearPosiVel(n, index, margin = 0) { // crea dos n-arrays con las posiciones y velocidades de n partículas

		const buffer = new ArrayBuffer(n * 8 * 4) // n partículas, cada una tiene 28B (4*4B para la pos y 3*4B para la vel)

		const pos = new Float32Array(buffer, 0, n*4); // buffer al que hace referencia, byte offset, number of elements. [x1, y1, z1, w1, x2, y2, ...]
		const vel = new Float32Array(buffer, n*4*4, n*4);

		//const start = performance.now();
		for (let i=0 ; i < n*4 ; i += 4) {
			[ pos [i], pos[i+1], pos [i+2], pos[i+3] ] = randomPosition(index, margin); // randomPosition devuelve un array [x,y,z,w]
			[ vel [i], vel[i+1], vel [i+2], vel[i+3] ] = randomVelocity();
		}
		//console.log((performance.now()-start).toFixed(3))

		return [pos, vel]
	}
	function validarNumberInput(input, estricto=true) {
		/* input es un objeto representando un html element input de type number.
		Estricto significa que no admite valores afuera del rango. */

		if (input.validity.valid) {
			return true;
		}

		if (input.validity.badInput) {
			titilarBorde(input, "red");
			return false;
		}

		const outsideRange = (input.validity.rangeUnderflow || input.validity.rangeOverflow);

		if (!outsideRange) {
			return true;
		}

		if (!estricto && outsideRange) {
			titilarBorde(input, "yellow"); //console.log(`${input.id} returns true in validar`)
			return true;
		}

		//console.table(input.validity)

		titilarBorde(input, "red");
		return false;
	}
	function importarJson(path="") {
		const msg = "Error detectado antes de importar."

		if (path) { // Load from server file.

			return new Promise ((resolve, reject) => {

				fetch(path)
				.then( (response) => { return response.json() })
				.catch((error) => { reject(labelError(error, msg)); })
				.then( (json) => { resolve(json); })
			});
			/* Async solution expanded
				const promise = fetch(path);
				const response = await fetch(path);
				const json = await response.json();
				return(json);
			*/
		} 

		// Load from user prompt
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".json";

		return new Promise((resolve, reject) => {

			fileInput.onchange = (event)=> {
				const file = event.target.files[0];
				const reader = new FileReader();

				reader.onload = _=> {
					try {
						const jsonData = JSON.parse(reader.result);
						resolve(jsonData);
					} catch (error) { reject(error); }
				}
				reader.onerror = (error) => { reject(labelError(error, msg)); }
				reader.readAsText(file);
			};
			
			fileInput.click();
		});

	}
	function includesIn2nd(array, num) { // busca num entre el 2do elemento de los subarrays dentro de array
		return array.some(subarray => subarray[1] == num);
	}
	function findIndexOf2nd(array, num) { // devuelve el índice del subarray que cumple includesIn2nd
		return array.findIndex(subarray => subarray[1] == num);
	}
	function expandir(m) { // agrega una columna y fila de ceros a una matriz
		const newFil = Array(m.length).fill(0);
		m.push(newFil);
		m.forEach(fil => fil.push(0));
	}
	function matrizDistancias(m, D, rule) { // actualiza la matriz triangular de interacciones con la regla proporcionada

		const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.targetName});
		const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.sourceName});
		
		/*	Agregar familias a lista D de familias que interactúan de alguna forma, si no lo estaban ya.
		*	La lista D también asocia cada familia interactuante (su índice en la lista de los selectores) 
		*	con su índice en la matriz de interacciones.
		*/
		let a, b;
		if (!includesIn2nd(D, targetIndex)) {
			// Nueva familia que tendrá interacciones
			a = D.length;
			D.push([a, targetIndex, rule.targetName]);
			expandir(m);
		} else { a = findIndexOf2nd(D, targetIndex) }

		if (!includesIn2nd(D, sourceIndex)) {
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

		// Agregar la nueva interacción a la matriz triangular de interacciones (Se le suma 1 a la casilla correspondiente)

		const fil = D[a][0];
		const col = D[b][0];
		m[ fil ] [ col ] ++;

		return [m, D];
	}
	function hasSameStructure(obj1, obj2) { 
		// no revisa la estructura de los arrays de elementaries y rules
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
	function mapAndPadNtoXNUint(array, x) { // [1,2,3] -> UintArray [1, 0...0, 2, 0...0, 3, 0...0]
		const typedArray = new Uint32Array(array.length * x);
		for (let i = 0; i < typedArray.length; i += x) {
			typedArray[i] = array[i/x];
		}
		return typedArray;
	}
	function rgba_to_hexString(rgbaArray) {
		const [r, g, b] = rgbaArray;
		const hexR = Math.floor(r * 255).toString(16).padStart(2, '0');
		const hexG = Math.floor(g * 255).toString(16).padStart(2, '0');
		const hexB = Math.floor(b * 255).toString(16).padStart(2, '0');
		return `#${hexR}${hexG}${hexB}`;
	}
	function sqMatVal(m, f, c) {
		const numCols = Math.sqrt(m.length);
		return m[f * numCols + c]
	}
	function labelError(error, label="Default error label") {
		const labeledError = new Error (label);
		labeledError.cause = error;
		return labeledError;
	}
	function generateHistogram2(data, lim=1, nBins=10) {
		const histogram = [];

		// Initialize histogram bins
		for (let i = 0; i < nBins; i++) {
			histogram[i] = 0;
		}

		// Calculate bin size
		const min = -lim//Math.min(...data);
		const max = lim//Math.max(...data);
		const binSize = (max - min) / nBins;

		// Increment bin counts
		data.forEach((value) => {
			const binIndex = Math.floor((value - min) / binSize);
			histogram[binIndex]++;
		});

		let logLines = "";
		// Display histogram
		for (let i = 0; i < nBins; i++) {
			const binStart = min + i * binSize;
			const binEnd = binStart + binSize;
			const binCount = histogram[i];
			logLines += `[${binStart.toFixed(2)} :: ${binEnd.toFixed(2)}]: ${binCount}\n`
		}
		console.log(logLines);

		const sumNeg = histogram.slice(0, 4+1).reduce((a,b)=>a+b,0);
		const sumPos = histogram.slice(5, 9+1).reduce((a,b)=>a+b,0);
		let bal = ""
		if (sumPos>sumNeg) {
			bal = "+++";
		} else if (sumPos<sumNeg) {
			bal = "---"
		}

		console.log(`          balance: ${sumNeg} // ${sumPos}   (${bal})`)
	}
	function mostrarParamsArray (paramsArray, Ne) {
		const debugHelp = ["N", "Ne", "ancho", "alto",];
		let offset = 4;
		for (let i = offset; i < offset+Ne; i++) {
			debugHelp.push(`Acum (${i-offset})`);
		} offset += Ne;
		for (let i = offset; i < offset+Ne; i++) {
			debugHelp.push(`Radio (${i-offset})`);
		} offset += Ne;
		for (let i = offset; i < offset+4*Ne; i+=4) {
			debugHelp.push(`R (${Math.floor((i-offset)/4)})`);
			debugHelp.push(`G (${Math.floor((i-offset)/4)})`);
			debugHelp.push(`B (${Math.floor((i-offset)/4)})`);
			debugHelp.push(`A (${Math.floor((i-offset)/4)})`);
		}

		const tabla = [];
		for (let i = 0; i < paramsArray.length; i++) {
			tabla.push([paramsArray[i], debugHelp[i]]);
		}
		console.table(tabla);
	}
	function MAX_SAFE_Ingeter () {
		let n = 0;
		try{
		while (n+1 > n-1) {
			++n;
		}} catch(error) {
			return n-2; // security margin
		}
		return n
	}

	// Utilities for some HTML elements
	function playSound(soundElement, avoidSpam=true) { 
		if ((avoidSpam && soundElement.currentTime > 0.05) || !avoidSpam) {
			soundElement.currentTime = 0; 
		}
		soundElement.play(); 
	}
	function titilarBorde(element, color="red") {
		element.classList.add("titilante");
		element.style.setProperty("--titil-color", color);
	}
	function removeOptions(htmlElement) { 
		htmlElement.options.length = 0; //<- only for select elements
		//htmlElement.innerHTML = "";
		//while (htmlElement.firstChild) {
		//	htmlElement.removeChild(htmlElement.firstChild);
			//htmlElement.remove(0) <- only for select elements
		//}
		//$(htmlElement).children().remove();
	}
	function switchClass(element, className, state) {
		// por defecto la alterna. Si tiene una input, lo pone acorde a ella. Devuelve el estado.

		const list = element.classList;

		if (state === undefined) {
			if (list.contains(className)) {
				list.remove(className);
				return false;
			}
			else {
				list.add(className);
				return true;
			}
		}

		if (state) {
			list.add(className);
			return true;
		} else {
			list.remove(className)
			return false;
		}

	}
	function switchVisibilityAttribute(element) {
		element.hidden ^= true;
	}
	function setAutomaticInputElementWidth (inputElement, min, max, padding) {
		// falla para xxxxe porque allí value = "" -> length = 0

		if (inputElement.validity.badInput) {return;}

		const ancho = Math.max(inputElement.value.length, inputElement.placeholder.length);
		inputElement.style.width = `${ Math.min(Math.max(ancho, min) + padding, max) }ch`;
	}
	function checkAndGetNumberInput(input, failFlag, strict = true, P=true) {
		// For chained checks before value usage. Supports exponential notation.
		if (!validarNumberInput(input, strict)) { 			// Is it a bad input (aka not a number)?
			return [undefined, true];							// fail, set flag.
		}
		else if (P && !input.value && input.placeholder) { 	// Is it empty and has a placeholder (asumed valid)?
			return [Number(input.placeholder), failFlag];		// return placeholder number, pass flag.
		}
		else if (input.value) {								// Is it not empty?
			if (input.step === "1") {							// Is it supposed to be an integer?
				return [Math.trunc(input.value), failFlag];		// return int, pass flag.
			} else {
				return [parseFloat(input.value), failFlag];		// return float, pass flag.
			}
		}
		else {												// No placeholder or valid value.
			titilarBorde(input,"red");
			return [undefined, true];							// fail, set flag.
		}
	}
	function suggestReset(element, flag, done="default value") {

		if (done === "done") {
			element.style.setProperty("border-color","rgba(255, 255, 255, 0.2)");
			flag = false;
		} else if (done !== "default value") {
			console.warn("Wrong input");
		} else {
			element.style.setProperty("border-color","rgba(255, 165, 0, 1)");
			flag = true;
		}
	}

	// Classes and their handling
	class Elementary {
		constructor(nombre, color, cantidad, radio, posiciones, velocidades) {
			// Check input parameter types and sizes
			if (typeof nombre !== "string") {
				throw new Error("Nombre no es string.");
			}
			if (color.constructor !== Float32Array || color.length !== 4) {
				throw new Error("Color no es Float32Array de 4 elementos.");
			}
			if (!Number.isInteger(cantidad) || cantidad < 0) {
				throw new Error("Cantidad no es un entero >= 0.");
			}
			if (typeof radio !== "number" || radio <= 0) {
				throw new Error("Radio no es un número positivo.");
			}
			this.#validateArray(posiciones, "posiciones");
			this.#validateArray(velocidades, "velocidades");

			this.nombre = nombre;
			this.color = color;
			this.cantidad = cantidad;
			this.radio = radio;
			this.posiciones = posiciones;
			this.velocidades = velocidades;

		}
		static fromJsonObjectLit(obj) {
			return new Elementary(
				obj.nombre,
				new Float32Array(obj.color),
				obj.cantidad,
				obj.radio,
				new Float32Array(obj.posiciones),
				new Float32Array(obj.velocidades)
			);
		}
		isFilled(prop) {
			switch (prop) {
				case "posiciones":
					return this.posiciones.length === this.cantidad * 4;
				case "velocidades":
					return this.velocidades.length === this.cantidad * 4;
				default:
					console.log("a")
					throw new Error('isFilled() sólo acepta "posiciones" o "velocidades".');
			}
		}

		get filledPosiVels() {
			let str = "";
			if (this.isFilled("posiciones")) { str += "posi"; }
			if (this.isFilled("velocidades")) { str += "vels"; }
			return str;
		}

		get colorAsHex() {
			const [r, g, b] = this.color;
			const hexR = Math.floor(r * 255).toString(16).padStart(2, "0");
			const hexG = Math.floor(g * 255).toString(16).padStart(2, "0");
			const hexB = Math.floor(b * 255).toString(16).padStart(2, "0");
			return `#${hexR}${hexG}${hexB}`;
		}

		get asJsonObjectLit() {
			return {
				nombre: this.nombre,
				color: Array.from(this.color),
				cantidad: this.cantidad,
				radio: this.radio,
				posiciones: [],
				velocidades: []
			}
		}

		get asJsonObjectLitFull() {
			const output = this.asJsonObjectLit;
			output.posiciones = Array.from(this.posiciones);
			output.velocidades =  Array.from(this.velocidades);
			console.log("output")
			return output;
		}

		#validateArray(array, inputName) {
			if (array.constructor !== Float32Array && !(Array.isArray(array) && array.length === 0)) {
				throw new Error (`Entrada ${inputName} inválida`);
			}
		}
	}
	function cargarElementary(newElementary) {
		if (!(newElementary instanceof Elementary)) { throw new Error("No es una instancia de Elementary"); }
		let i = elementaries.length;
		if ( elementaries.some(dict => dict.nombre == newElementary.nombre) ){
			console.log("Reemplazando partículas homónimas...")
			i = elementaries.findIndex(dict => dict.nombre == newElementary.nombre);
			elementaries [i] = newElementary;
		} else {
			elementaries.push(newElementary);
			actualizarElemSelectors(newElementary); // actualizar lista de nombres en el creador de reglas de interacción
			if (newParticles.length) { newParticles.push([]); } // Si estoy colocando partículas manualmente, agregar el slot.
		}
		partiControls.selector.selectedIndex = i;
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
	class Rule {
		constructor(ruleName, targetName, sourceName, intensity, quantumForce, minDist, maxDist) {
			this.ruleName = ruleName || `${targetName} ← ${sourceName}`;
			this.targetName = targetName;
			this.sourceName = sourceName;
			this.intensity = intensity;
			this.quantumForce = quantumForce;
			this.minDist = minDist;
			this.maxDist = maxDist;
		}
		static fromJsonObjectLit(obj) {
			return new Rule(
				obj.ruleName, obj.targetName, obj.sourceName, obj.intensity, 
				obj.quantumForce, obj.minDist, obj.maxDist
			);
		}
	}
	function cargarRule(newRule) {
		if (!(newRule instanceof Rule)) { throw new Error("No es una instancia de Rule"); }
		let i = rules.length;
		if ( rules.some(dict => dict.ruleName === newRule.ruleName) ){
			console.log("Reemplazando regla homónima...")
			i = rules.findIndex(dict => dict.ruleName === newRule.ruleName);
			rules[i] = newRule;
		} else {
			rules.push(newRule);
			actualizarRuleSelector(newRule); // actualizar lista de nombres en el creador de reglas de interacción
		}
		ruleControls.selector.selectedIndex = i;
	}
	class Setup {
		constructor(name, seed, ambient, elementaries, rules) {

			this.#validateCanvasDims(ambient.canvasDims);
			this.#validateObjectArray(elementaries, Elementary);
			this.#validateObjectArray(rules, Rule);

			this.name = name;
			this.seed = seed;
			this.ambient = ambient;
			this.elementaries = elementaries;
			this.rules = rules;
		}
		static fromJsonObjectLit(obj) {
			return new Setup(
				obj.name,
				obj.seed,
				obj.ambient,
				obj.elementaries.map(elem => Elementary.fromJsonObjectLit(elem)),
				obj.rules.map(rule => Rule.fromJsonObjectLit(rule)),
			);
		}
		
		#validateCanvasDims(dims) {
			if (!Number.isInteger(dims[0]) && dims[0] !== "auto" && dims[0] !== "previous") {
				throw new Error("Invalid canvas width.");
			}
			if (!Number.isInteger(dims[1]) && dims[1] !== "auto" && dims[1] !== "previous") {
				throw new Error("Invalid canvas height.");
			}
		}
		#validateObjectArray(array, _class) {
			for (let obj of array) {
				if (!(obj instanceof _class)) throw new Error(`${obj} is not instance of ${_class.name}.`);
			}
		}
		#validateRules(rules) {
			for (let rule of rules) {
				if (!(rule instanceof Rule)) { throw new Error(`${rule?.ruleName} is not instance of Elementary.`); }
			}
		}
		
		get asJsonObjectLit() {
			return {
				name: this.name,
				seed: this.seed,
				ambient: this.ambient,
				elementaries: this.elementaries.map(elem => elem.asJsonObjectLit),
				rules: this.rules
			}
		}
		get asJsonObjectLitFull() {
			const output = this.asJsonObjectLit;
			output.elementaries = this.elementaries.map(elem => elem.asJsonObjectLitFull);
			return output;
		}
	}
	async function importSetup(path) {

		const jsonPromise = importarJson(path)
		.catch((error) => {
			window.alert("Error al importar, archivo descartado.\n" + error);
		});

		const json = await jsonPromise;

		return Setup.fromJsonObjectLit(json);
	}
	function cargarSetup(setup, draw = false) {
				
		if (!(setup instanceof Setup)) { throw new Error("Falló la verificación, no es un objeto de clase Setup.")}
		
		// Load ambient // resetear() lo termina de cargar
		ambientControls.inputs.friction.value = setup.ambient.friction.toString();
		ambientControls.inputs.bounce.value = setup.ambient.bounce.toString();
		ambientControls.inputs.vel.value = setup.ambient.maxInitVel.toString();
		ambient.maxInitVel = setup.ambient.maxInitVel;

		// Load canvas size to ambient
		let str = "";
		switch (setup.ambient.canvasDims[0]) {
			case "auto":
				str += "width";
				break;
			case "previous":
				break;
			default:
				ambient.canvasDims[0] = setup.ambient.canvasDims[0];
		}
		switch (setup.ambient.canvasDims[1]) {
			case "auto":
				str += "height";
				break;
			case "previous":
				break;
			default:
				ambient.canvasDims[1] = setup.ambient.canvasDims[1];
		}

		if (str) {
			[ambient.canvasDims[0] = ambient.canvasDims[0], 
			 ambient.canvasDims[1] = ambient.canvasDims[1]] = 
			autoCanvasDims(canvasContainer, str);
		}

		// Load seed
		setRNG(setup.seed);
		if (setup.seed) { seedInput.value = setup.seed.toString(); }
		else { seedInput.value = ""; }
		
		// Load elementaries
		vaciarSelectors();

		elementaries = setup.elementaries;

		let msgCp = "Import: Creadas posiciones para ", msgCv = "Import: Creadas velocidades para ";
		let msgLp = "Import: Cargadas posiciones para ", msgLv = "Import: Cargadas velocidades para ";

		for (let index = 0; index < elementaries.length; index++) {

			const elem = elementaries[index];

			const nom = elem.nombre + ", ";
			switch (elem.filledPosiVels) {

				case "":
					[elem.posiciones, elem.velocidades] =  crearPosiVel(elem.cantidad, index, elem.radio * 2);
					msgCp += nom;
					msgCv += nom;
					break;
				
				case "posi":
					[ , elem.velocidades] =  crearPosiVel(elem.cantidad, index, elem.radio * 2);
					msgLp += nom;
					msgCv += nom;
					break;

				case "vels":
					[elem.posiciones, ] =  crearPosiVel(elem.cantidad, index, elem.radio * 2);
					msgCp += nom;
					msgLv += nom;
					break;

				case "posivels":
					msgLp += nom;
					msgLv += nom;
					break;
				
				default:
					console.warn("Error cargando setup.");
			}

			actualizarElemSelectors(elem);
		}

		if (msgCp.length !== 32) { console.log(msgCp.slice(0,-2) + "."); }
		if (msgCv.length !== 33) { console.log(msgCv.slice(0,-2) + "."); }
		if (msgLp.length !== 33) { console.log(msgLp.slice(0,-2) + "."); }
		if (msgLv.length !== 34) { console.log(msgLv.slice(0,-2) + "."); }

		if (elementaries.length) {partiControls.placeButton.hidden = false;}

		// Load rules
		rules = setup.rules;
		for (let rule of rules) { actualizarRuleSelector(rule); }

		flags.justLoadedSetup = true;
		resetear(draw);
		setPlaceholdersParticles();
		setPlaceholdersRules();
		console.log("Setup " + setup.name + " cargado.");

	}
	function exportarSetup(setup, filename = "Cells GPU setup", savePosiVels = false) {
		
		let exportSetup;

		if (savePosiVels) {
			exportSetup = setup.asJsonObjectLitFull;
			console.log("Exportando con posiciones y velocidades.");
		} else {
			exportSetup = setup.asJsonObjectLit;
		}

		const jsonString = JSON.stringify(exportSetup, null, 2);

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
	function generarSetupClásico(m, seed) {
		const e = [];
		const elementaries = [
			new Elementary("A", new Float32Array([1,1,0,1]), 300*m, 3, e, e), //300
			new Elementary("R", new Float32Array([1,0,0,1]), 80*m, 4, e, e),	//80
			new Elementary("P", new Float32Array([128/255,0,128/255,1]), 30*m, 5, e, e),	//30
			new Elementary("V", new Float32Array([0,128/255,0,1]), 5, 7, e, e),				//5 r7
		];

		/*q = 0.25 * g_clásico * q_clásico. q_clásico = [0.2, 0, 1, 0, 1, 0, 1, 0, 0.2] */
		const rules = [ //  nom/tar/src /I    /q    /dmin/dmax
			new Rule("","R","R",  0.5, 0.025, 15,	100 ), 	// los núcleos se tratan de juntar si están cerca
			new Rule("","A","R",  0.5, 0.0,   60,	600 ), 	// los electrones siguen a los núcleos, pero son caóticos
			new Rule("","A","A", -0.1, 0.025, 20,	600 ),
			new Rule("","P","R",  0.4, 0.0,   0.1, 150 ), 	// los virus persiguen a los núcleos
			new Rule("","P","A", -0.2, 0.05,  0.1, 100 ),	// los virus son repelidos por los electrones
			new Rule("","A","P",  0.2, 0.0,   0.1, 100 ), 	// los electrones persiguen a los virus
			new Rule("","R","P",  1.0, 0.25,  0.1, 10  ), 	// los virus desorganizan los núcleos
			new Rule("","R","V",  0.3, 0.0,   50,  1000), 	// los núcleos buscan comida
			new Rule("","V","V", -0.2, 0.01,  50,  200 ), 	// la comida se mueve un poco y estabiliza las células
		];

		return new Setup(
			"Clásico (X" + m + ")",
			seed,
			{
				friction: (m-1) * (0.008-0.005) / (10-1) + 0.005, //0.005 default
				bounce: 80,
				maxInitVel: 0,
				canvasDims: ["auto", "auto"],
			},
			elementaries,
			rules,
		)
	}
	function generarSetupDebug(m, seed) {
		const e = [];
		const elementaries = [
			new Elementary("A", new Float32Array([1,1,0,1]), 300*m, 3, e, e),
		];

		const rules = [ //  nom/tar/src /I    /q    /dmin/dmax
			new Rule("","R","R",  0.5, 0.025, 15,	100 ),
		];

		return new Setup(
			"Debug",
			seed,
			{
				friction: 0.005,
				bounce: 80,
				maxInitVel: 0,
				canvasDims: ["auto", "auto"],
			},
			elementaries,
			rules,
		)
	}

	// UI/CPU data handling
	function setRNG(seed) {
		//console.log(`setRNG(${seed}) called`)
		if (seed == "") {
			seed = Math.random().toFixed(7).toString();
		}
		rng = new alea(seed);
		seedInput.placeholder = seed;
	}
	function vaciarSelectors(){ // orig: 1ms // innerhtml ="": 0.76ms // length = 0: 0.73ms + no html recomp.
		removeOptions(partiControls.selector);
		removeOptions(ruleControls.selector);
		removeOptions(ruleControls.targetSelector);
		removeOptions(ruleControls.sourceSelector);
	}
	function actualizarElemSelectors(elementary) {

		const selectorsEstabanVacíos = (ruleControls.targetSelector.options.length === 0) 

		const option = document.createElement("option");

		option.value = elementary.nombre;
		option.text = elementary.nombre;

		ruleControls.targetSelector.appendChild(option);

		const option2 = option.cloneNode(true);
		ruleControls.sourceSelector.appendChild(option2);

		const option3 = option.cloneNode(true);
		partiControls.selector.appendChild(option3);

		if (selectorsEstabanVacíos) { setPlaceholderRuleName(); }

	}
	function actualizarRuleSelector(rule) {
		const option = document.createElement("option");
		option.text = rule.ruleName;
		ruleControls.selector.appendChild(option);
	}
	function setPlaceholdersParticles() {
		const i = partiControls.selector.selectedIndex;
		if (i === -1) {return;}
		partiControls.nameInput.placeholder = elementaries[i].nombre ?? "";
		partiControls.colorInput.value = elementaries[i].colorAsHex;//rgba_to_hexString(elementaries[i].color);
		partiControls.cantInput.placeholder = elementaries[i].cantidad;
		partiControls.radiusInput.placeholder = elementaries[i].radio;
	}
	function setPlaceholdersRules() {
		const i = ruleControls.selector.selectedIndex;
		if (i === -1) {return;}
		ruleControls.nameInput.placeholder = rules[i].ruleName;
		ruleControls.targetSelector.selectedIndex = elementaries.findIndex(elem => elem.nombre === rules[i].targetName);
		ruleControls.sourceSelector.selectedIndex = elementaries.findIndex(elem => elem.nombre === rules[i].sourceName);
		ruleControls.intens.placeholder = rules[i].intensity;
		ruleControls.qm.placeholder = rules[i].quantumForce;
		ruleControls.dmin.placeholder = rules[i].minDist;
		ruleControls.dmax.placeholder = rules[i].maxDist;
	}
	function setPlaceholderRuleName() {
		const A = elementaries[ruleControls.targetSelector.selectedIndex].nombre;
		const B = elementaries[ruleControls.sourceSelector.selectedIndex].nombre;
		ruleControls.nameInput.placeholder = A + " ← " + B;
	}
	function removePartiControlsValues() {
		partiControls.nameInput.value = "";
		partiControls.cantInput.value = "";
		partiControls.radiusInput.value = "";
	}
	function removeRuleControlsValues() {
		ruleControls.nameInput.value = "";
		ruleControls.intens.value = "";
		ruleControls.qm.value = "";
		ruleControls.dmin.value = "";
		ruleControls.dmax.value = "";
	}
	function hideCPOptions() { 
		CPOptions.hidden ^= true;
		if (CPOptions.hidden){ panelTitle.style = "height: 3ch;"; } else { panelTitle.style = ""; }
	}
	function allParticlesDeleted() {
		borraParticleButton.hidden = true;
		partiControls.placeButton.hidden = true;

		placePartOnClic = false;
		switchClass(partiControls.placeButton, "switchedoff", true);
		canvas.style.cursor = "default";
	}
	function updateUIAfterRulesChange() {
		setPlaceholdersRules();
		markers[3].hidden = false;
		if (partiControls.updateButton.classList.contains("disabled")) {
			switchClass(ruleControls.updateButton, "disabled", false);
		}
	}
	function clearTempParticles() {
		tempParticles.replaceChildren();
		newParticles = [];
		const placeButtonOff = !partiControls.placeButton.classList.contains("switchedoff");
		switchClass(borraParticleButton, "disabled", placeButtonOff);
	}
	function getDeltas(event) {
		const [x1, y1] = [mDownX, mDownY];
		const [x2, y2] = [event.offsetX, event.offsetY];
		return [x2 - x1, y2 - y1];
	}

	// Simulation flow
	function pausar() {
		if (!paused) {
			pauseButton.innerText = "Resumir";
			cancelAnimationFrame(animationId); //redundante pero a veces ahorra pasos
		} else {
			pauseButton.innerText = "Pausa";
			refTime = performance.now();
			frameCounter = 0;
			animationId = requestAnimationFrame(newFrame);
		}
		paused = !paused;
		stepping = false;
		resetButton.hidden = false;
	}
	function stepear() {
		stepping = true;
		paused = true;
		animationId = requestAnimationFrame(newFrame);
		pauseButton.innerText = "Resumir";
		resetButton.hidden = false;
	}
	function resetear(draw=true) {
		frame = 0;
		clearTempParticles();
		applyCanvas();
		applyAmbient();
		applyParticles();
		applyRules();
		
		//suggestReset(resetButton, awaitingResetCall, "done");
		if (paused && draw) {
			stepear();
		}
	}

	// WebGPU utilities
	async function readBuffer(device, buffer) {
		const size = buffer.size;
		const gpuReadBuffer = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const copyEncoder = device.createCommandEncoder();
		copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);
		device.queue.submit([copyEncoder.finish()]);
		await gpuReadBuffer.mapAsync(GPUMapMode.READ);
		return gpuReadBuffer.getMappedRange();
	}
	function timestamp(timestampIndex, encoder) {
		const i = timestampIndex;
		if (i >= capacity) {
			console.warn(`Discarded timestamp index ${i} >= ${capacity}`);
			return;
		}

		if (timer) {
			encoder.writeTimestamp(querySet, i);
			if (i === capacity - 1) {
				encoder.resolveQuerySet(
					querySet,
					0,				// index of first query to resolve 
					capacity,		// number of queries to resolve
					queryBuffer,
					0				// destination offset
				);
			}
		} else { t[i] = window.performance.now(); }
	}
	function createPosiVelsGPUBuffers (sizeP, sizeV) {
		GPUBuffers.positionBuffers = [
			device.createBuffer({
				label: "Positions buffer IN",
				size: sizeP,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			}),
			device.createBuffer({
				label: "Positions buffer OUT",
				size: sizeP,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			})
		];
		GPUBuffers.velocities = device.createBuffer({
			label: "Velocities buffer",
			size: sizeV,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
		});
	}
	function getTextureView(dims) {
		const texture = device.createTexture({
			size: dims,
			sampleCount,
			format: canvasFormat,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return texture.createView();
	}

	// Prepare to edit buffers (or do so if immediately possible)
	function applyCanvas() {
		[canvas.width, canvas.height] = ambient.canvasDims;
		canvasInfo.innerText = `${canvas.width} x ${canvas.height} (${(canvas.width/canvas.height).toFixed(6)})`;
		textureView = getTextureView(ambient.canvasDims);
		flags.updateCanvas = true;
		flags.updateSimParams = true;
	}
	function applyAmbient() {
		let mustUpdate = false;
		const [friction, frictionInvalid] = checkAndGetNumberInput(ambientControls.inputs.friction, false, false);
		// obtiene número de input (value o placeholder)
		if (!frictionInvalid) {
			ambientControls.inputs.friction.value = "";
			if (ambient.friction !== friction) {
				ambient.friction = friction;
				ambientControls.inputs.friction.placeholder = friction;
				mustUpdate = true;
			}
		}

		const [bounce, bounceInvalid] = checkAndGetNumberInput(ambientControls.inputs.bounce, false, false);
		if (!bounceInvalid) {
			ambientControls.inputs.bounce.value = "";
			if ( ambient.bounce !== Math.max(bounce, 0)) {
				ambient.bounce = Math.max(bounce, 0);
				ambientControls.inputs.bounce.placeholder = ambient.bounce;
				mustUpdate = true;
				setAutomaticInputElementWidth(ambientControls.inputs.bounce, 3, 12, 0);
			}
		}

		let [vel, velInvalid] = checkAndGetNumberInput(ambientControls.inputs.vel, false, false);
		if (!velInvalid) {
			ambientControls.inputs.vel.value = "";
			vel = Math.abs(vel);
			if ( vel !== ambient.maxInitVel || flags.justLoadedSetup) {
				ambient.maxInitVel = vel;
				ambientControls.inputs.vel.placeholder = vel;
				mustUpdate = true
			}
		}

		if (mustUpdate) {
			flags.editAmbient = true;
			flags.updateSimParams = true;
		}
		switchClass(ambientControls.updateButton, "disabled", true);
		markers[1].hidden = true;
	}
	function applyRules() {
		switchClass(ruleControls.updateButton, "disabled", true)
		markers[3].hidden = true;
		flags.rulesModified = false;
		flags.updateRules = true;
		flags.updateSimParams = true;
	}
	function applyParticles() {
		flags.resetParts = true;
		flags.updateParticles = true;
		flags.updateSimParams = true;
		switchClass(partiControls.updateButton, "disabled", true);
		markers[2].hidden = true;
		if (flags.rulesModified) {
			switchClass(ruleControls.updateButton, "disabled", false);
			markers[3].hidden = false;
		}
	}
	function applyParticlesStyle() {
		const i = parseInt(pStyleRange.value);
		styleSettings.particleStyle = particleStyles[i];

		if (paused) {
			writePStyleToBuffer()
			const encoder = device.createCommandEncoder();
			render(encoder, Math.max(frame - 1, 0));
			device.queue.submit([encoder.finish()]);
		} else {
			flags.editPStyle = true;
			flags.updateSimParams = true;
		}
	}

	// Functions to edit buffers (usually used by editBuffers())
	function writeCanvasToBuffer() {
		paramsArrays.canvasDims.set(ambient.canvasDims);
		device.queue.writeBuffer(GPUBuffers.params, 0, paramsArrays.canvasDims);
		flags.updateCanvas = false;
	}
	function writeAmbientToBuffer() {
		paramsArrays.ambient.set([1 - ambient.friction, ambient.bounce / 100]);
		device.queue.writeBuffer(GPUBuffers.params, 28, paramsArrays.ambient);
		flags.editAmbient = false;
	}
	function updateDatosElementariesBuffer(Ne) {

		const datosElemsSize = (3 * 4 + 4 + 16) * Ne; // 3 cants, radio, color
		const datosElementariesArrBuffer = new ArrayBuffer(datosElemsSize);
		N = 0;
	
		for (let i = 0; i < Ne; i++) {  //N, radios, colores, cantidades
	
			const nLocal = elementaries[i].cantidad;
			N += nLocal; // N también hace de acumulador para este for.
	
			const cants = new Uint32Array(datosElementariesArrBuffer, i * 8*4, 3);
			const radioColor = new Float32Array(datosElementariesArrBuffer, (i * 8*4) + 3*4, 5);
	
			cants.set([nLocal, N, N-nLocal]);	// [cants, cantsacum, cantsAcum2]
			radioColor.set([elementaries[i].radio]);
			radioColor.set(elementaries[i].color,1);
		}
	
		paramsArrays.N.set([N]);
		device.queue.writeBuffer(GPUBuffers.params, 8, paramsArrays.N);
	
		GPUBuffers.datosElementaries = device.createBuffer({
			label: "Buffer: datos elementaries",
			size: datosElemsSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		})
		device.queue.writeBuffer(GPUBuffers.datosElementaries, 0, datosElementariesArrBuffer, 0, datosElemsSize);
	}
	function updateParticlesBuffers() {

		const Ne = elementaries.length;
	
		paramsArrays.Ne.set([Ne]);
		device.queue.writeBuffer(GPUBuffers.params, 12, paramsArrays.Ne);
		
		updateDatosElementariesBuffer(Ne);
		
		if (flags.justLoadedSetup) { flags.resetParts = false; }
	
		for (let elem of elementaries) {
			const L = elem.cantidad * 4;
			const posiVelsIncompleto = (elem.posiciones.length !== L || elem.velocidades.length !== L);
			if (posiVelsIncompleto) {
				flags.resetParts = true;
				console.warn("Detectadas partículas faltantes, reseteando posiciones y velocidades...");
				break;
			}
		}
	
		// Agregar partículas manuales a las pre-existentes
		if (newParticles.length && !flags.resetParts) {
	
			const newParticlesF = newParticles.flat();
			const oldSize = GPUBuffers.velocities?.size ?? 0;
			const newSize = oldSize + newParticlesF.length * 4 * 4;
	
			//console.log("oldSize: " + oldSize + ", newSize: " + newSize);
	
			const newPositions = new Float32Array(newParticlesF.length * 4);
			const newVelocities = new Float32Array(newParticlesF.length * 4);
			let offset = 0;
	
			for (let i = 0; i<Ne; i++) {
				for (let p = 0; p < newParticles[i].length; p++ ) {
					newPositions.set(newParticles[i][p][0], offset);
					newVelocities.set(newParticles[i][p][1], offset);
					offset += 4;
				}
			}
	
			// New temporary buffers of size newSize > oldSize
			const tempPosBuffer = device.createBuffer({
				label: "Temp positions buffer",
				size: newSize,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			});
			const tempVelBuffer = device.createBuffer({
				label: "Temp velocities buffer",
				size: newSize,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			});
	
			// Fill the new section with the new data 
			device.queue.writeBuffer(tempPosBuffer, oldSize, newPositions);
			device.queue.writeBuffer(tempVelBuffer, oldSize, newVelocities);
	
			// Fill the old section with the old data
			const copyEncoder = device.createCommandEncoder(); // Create encoder
	
			if (GPUBuffers.positionBuffers && GPUBuffers.velocities) {
				copyEncoder.copyBufferToBuffer(GPUBuffers.positionBuffers[frame % 2], 0, tempPosBuffer, 0, oldSize);
				copyEncoder.copyBufferToBuffer(GPUBuffers.velocities, 0, tempVelBuffer, 0, oldSize);
			}
	
			// Re-create the used buffers
			createPosiVelsGPUBuffers (newSize, newSize);
	
			// Fill them with the data from the temporary buffers
			copyEncoder.copyBufferToBuffer(tempPosBuffer, 0, GPUBuffers.positionBuffers[frame % 2], 0, newSize);
			copyEncoder.copyBufferToBuffer(tempVelBuffer, 0, GPUBuffers.velocities, 0, newSize);
	
			device.queue.submit([copyEncoder.finish()]); // Submit encoder
	
			console.log("Frame " +frame+ ": Añadidas partículas manuales a los GPUBuffers.");
			clearTempParticles();
	
		}
	
		// Resetear posivels o cargar posiciones precargadas
		if (flags.justLoadedSetup || flags.resetParts || frame === 0) {
			
			let offset = 0, pos = [], vel = [];
			const positionsArray = new Float32Array(N*4);
			const velocitiesArray = new Float32Array(N*4);
	
			// llenar positionsArray y velocitiesArray
			for (let i = 0; i<Ne; i++) {
				if (flags.resetParts) {
					[pos, vel] = crearPosiVel(elementaries[i].cantidad, i, elementaries[i].radio * 2);
					elementaries[i].posiciones = pos;
					elementaries[i].velocidades = vel;
				} else {
					pos = elementaries[i].posiciones;
					vel = elementaries[i].velocidades;
				}
	
				positionsArray.set(pos, offset);
				velocitiesArray.set(vel, offset);
	
				offset += elementaries[i].cantidad*4;
			}
	
			createPosiVelsGPUBuffers (positionsArray.byteLength, velocitiesArray.byteLength);
			device.queue.writeBuffer(GPUBuffers.positionBuffers[frame % 2], 0, positionsArray);
			device.queue.writeBuffer(GPUBuffers.velocities, 0, velocitiesArray);
	
			if (flags.resetParts) { console.log("Partículas reseteadas y asignadas a los GPUBuffers."); }
			else { console.log("Partículas asignadas a los GPUBuffers."); }
			flags.resetParts = false;
			flags.justLoadedSetup = false;
			clearTempParticles();
		}
		flags.updateParticles = false;
	}
	function updateActiveRules() {
		const Ne = elementaries.length;
		const activeRules = [];
		const m = new Uint8Array(Ne**2);
		
		for (let rule of rules) {
			const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.targetName});
			const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.sourceName});
	
			if (targetIndex === -1 || sourceIndex ===-1) { continue; }
			activeRules.push(rule);
	
			const [f, c] = [targetIndex, sourceIndex].sort();
	
			const index = (f * Ne) + c;
			m[index]++;
		}
	
		const Nr = activeRules.length;
	
		paramsArrays.Nr.set([Nr]);
		device.queue.writeBuffer(GPUBuffers.params, 16, paramsArrays.Nr);
		return [activeRules, Nr, m];
	}
	function updateDistancesBuffers(Nr, m) {
		Nd = 0;
		let Npi = 0;
		let datosInteracciones = [];
		if (PRECALCULAR_DISTANCIAS && Nr) {
	
			Nd = 0;
			datosInteracciones = [];
			// recorro la matriz simétrica de interacciones
			for (let f = 0; f < Ne; f++) {
				for (let c = f; c < Ne; c++) {
		
					if ( sqMatVal(m, f, c) ) {
						const ndLocal = elementaries[f].cantidad * elementaries[c].cantidad;
						Nd += ndLocal; // Nd también hace de acumulador para este for.
	
						datosInteracciones.push([f, c, Nd, Nd - ndLocal]); // pares de interacciones y cants de distancias acum.
					}
				}
			}
			Npi = datosInteracciones.length;
		}
	
		GPUBuffers.distancias = device.createBuffer({
			label: "Distancias buffer",
			size: Nd * 4 || 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});
	
		const datosInteraccionesArray = new Uint32Array(datosInteracciones.flat());
		GPUBuffers.datosInteracciones = device.createBuffer({
			label: "datos interacciones buffer",
			size: Nd * 4 * 4 || 4,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		device.queue.writeBuffer(GPUBuffers.datosInteracciones, 0, datosInteraccionesArray);
	
		paramsArrays.Nd.set([Nd]);
		paramsArrays.Npi.set([Npi]);
		device.queue.writeBuffer(GPUBuffers.params, 20, paramsArrays.Nd);
		device.queue.writeBuffer(GPUBuffers.params, 24, paramsArrays.Npi);
	}
	function updateRulesBuffer(activeRules) {
		const Nr = activeRules.length;
		const rulesArray = new Float32Array(Nr * 8);
	
		for (let i = 0; i < Nr; i++) { // llenar el array de reglas
	
			const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == activeRules[i].targetName});
			const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == activeRules[i].sourceName});
	
			rulesArray.set([
				targetIndex,
				sourceIndex,
				activeRules[i].intensity,
				activeRules[i].quantumForce,
				activeRules[i].minDist,
				activeRules[i].maxDist,
				0.0,//padding
				0.0,
			], 8*i)
		}
	
		GPUBuffers.rules = device.createBuffer({
			label: "Reglas",
			size: rulesArray.byteLength || 32,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(GPUBuffers.rules, 0, rulesArray)
	
		flags.updateRules = false;
	}
	function writePStyleToBuffer() {
		const data = new Float32Array([styleSettings.particleStyle.borderWidth, styleSettings.particleStyle.spherical])
		paramsArrays.pStyle.set(data);
		device.queue.writeBuffer(GPUBuffers.params, 36, paramsArrays.pStyle);
		flags.editPStyle = false;
	}
	function writeRNGSeedToBuffer() {
		paramsArrays.seeds.set([
			rng() * 100,
			rng() * 100, // seed.xy
			1 + rng(),
			1 + rng(), // seed.zw
		])
		device.queue.writeBuffer(GPUBuffers.params, 48, paramsArrays.seeds);
	}
//

// ELEMENTOS HTML

	const
	canvasContainer = document.getElementById("canvascontainer"),
	// ambos paneles
	panels = document.getElementById("panels"),
	// panel de info
	infoPanel = document.getElementById("infopanel"),
	ageInfo = document.getElementById("ageinfo"),
	fpsInfo = document.getElementById("fpsinfo"),
	debugInfo = document.getElementById("debuginfo"),
	canvasInfo = document.getElementById("canvasinfo"),
	displayTiming = document.getElementById("performanceinfo"),
	// panel de opciones
	panelTitle = document.getElementById("controlPanelTitle"),
	CPOptions = document.getElementById("controlPanelOptions"),
	markers = {
		1: document.getElementById("marker1"),
		2: document.getElementById("marker2"),
		3: document.getElementById("marker3"),
	},
	// opciones
	pauseButton = document.getElementById("pausebutton"),
	stepButton = document.getElementById("stepbutton"),
	resetButton = document.getElementById("resetbutton"),

	seedInput = document.getElementById("seed"),
	//preloadPosButton = document.getElementById("preloadPositions"), CODE 0

	bgColorPicker = document.getElementById("bgcolorpicker"),
	pStyleRange = document.getElementById("pstyle"),

	volumeRange = document.getElementById("volume"),
	clickSound = document.getElementById("clicksound"),

	ambientOptionsTitle = document.getElementById("ambientoptionstitle"),
	ambientOptionsPanel = document.getElementById("ambientoptions"),
	ambientControls = {
		inputs: {
			friction: document.getElementById("friction"),
			bounce: document.getElementById("bounce"),
			vel: document.getElementById("initialvel"),
		},
		updateButton: document.getElementById("ambientupdate"),
	},

	creadorPartTitle = document.getElementById("creadorparticulasTitle"),
	creadorPartPanel = document.getElementById("creadorparticulas"),
	partiControls = {
		nameInput: document.getElementById("c.nom"),
		colorInput: document.getElementById("c.col"),
		cantInput: document.getElementById("c.cant"),
		radiusInput:document.getElementById("c.radius"),
		selector: document.getElementById("particleselect"),
		submitButton: document.getElementById("c.elemsubmit"),
		updateButton: document.getElementById("c.update"),
		placeButton: document.getElementById("c.place"),
	},
	borraParticleButton = document.getElementById("borraparticula"),

	creadorReglasTitle = document.getElementById("creadorreglasTitle"),
	creadorReglasPanel = document.getElementById("creadorreglas"),
	ruleControls = {
		nameInput: document.getElementById("rulename"),
		targetSelector: document.getElementById("targetselect"),
		sourceSelector: document.getElementById("sourceselect"),
		intens: document.getElementById("r.intens"),
		qm: document.getElementById("r.qm"),
		dmin: document.getElementById("r.dmin"),
		dmax: document.getElementById("r.dmax"),
		selector: document.getElementById("ruleselect"),
		submitButton: document.getElementById("r.submit"),
		updateButton: document.getElementById("r.update"),
	},
	borraRuleButton = document.getElementById("borrarule"),

	exportButton = document.getElementById("export"),
	importButton = document.getElementById("import"),
	infoButton = document.getElementById("mostrarinfo"),

	helpDialog = document.getElementById("helpdialog"),
	dialogOkButton = document.getElementById("dialogok"),
	dialogNVMButton = document.getElementById("dialognvm"),

	newsDialog = document.getElementById("newsdialog"),
	newsText = document.getElementById("newstext"),
	dialogOk2Button = document.getElementById("dialogok2"),
	dialogNVM2Button = document.getElementById("dialognvm2"),

	circle = document.getElementById("circle"),
	arrowEnd = document.getElementById("arrowend"),
	line = document.getElementById("line"),
	tempParticles = document.getElementById("temporarycircles");
//

// EVENT HANDLING

	// Botones de tiempo
	pauseButton.onclick = _=> pausar();
	stepButton.onclick = _=> stepear();
	resetButton.onclick = (event)=> {
		if (event.ctrlKey) {
			const path = SETUPS_FOLDER + "Cells GPU setup - Vacío.json"
			importSetup(path)
			.then( (setup) => { cargarSetup(setup, true);} );
			return;
		}
		resetear();
	}

	// Controles
	document.addEventListener("keydown", function(event) {
		
		const isTextInput = event.target.tagName === "INPUT" && event.target.type === "text";
		
		if (isTextInput || event.ctrlKey) { return; }

		if (event.target.type === "range") { event.target.blur(); }

		switch (event.code){
			case "Space":
				event.preventDefault();
				pausar(); playSound(clickSound);
				break;
			case "KeyR":
				resetear(); playSound(clickSound);
				break;
			case "KeyS":
				stepear(); playSound(clickSound);
				break;
			case "KeyW":
				hideCPOptions(); //playSound(clickSound);
				break;
			case "KeyM":
				muted = !muted;
				clickSound.volume = `${volumeRange.value * !muted}`;
				let alpha = 1;
				if (muted) { alpha = 0.3;}
				volumeRange.style.setProperty("--thumbg", `rgba(255, 255, 255, ${alpha})`);
				break;
			case "KeyI":
				switchVisibilityAttribute(infoPanel);
				break;
			case "KeyH":
				switchVisibilityAttribute(panels);
				break;
			case "KeyD":
				switchVisibilityAttribute(debugInfo);
				break;
		}
	});

	// Creador de elementaries / partículas
	partiControls.submitButton.onclick = _=> {

		let returnFlag = false,
		name = partiControls.nameInput,
		radius, cant;

		// Usar placeholders si vacíos. Si no lo están: validar.
		if (name.value) { name = name.value; } 
		else if (name.placeholder) { name = name.placeholder; }
		else { titilarBorde(name); returnFlag = true; }

		[cant, returnFlag] = checkAndGetNumberInput(partiControls.cantInput, returnFlag);
		partiControls.radiusInput.max = Math.min(canvas.height, canvas.width)/2;
		//console.log(partiControls.radiusInput.max);
		[radius, returnFlag] = checkAndGetNumberInput(partiControls.radiusInput, returnFlag);
		
		if (returnFlag) { return; }

		const elemIndex = partiControls.selector.selectedIndex;

		const [pos, vel] = crearPosiVel(cant, elemIndex, radius * 2);

		cargarElementary( new Elementary(
			name,
			hexString_to_rgba(partiControls.colorInput.value, 1),
			cant,
			radius,
			pos,
			vel,
		));
		setPlaceholdersParticles();
		removePartiControlsValues();
		borraParticleButton.hidden = false;
		partiControls.placeButton.hidden = false;
		switchClass(partiControls.updateButton, "disabled", false)
		switchClass(ruleControls.updateButton, "disabled", true);
		markers[2].hidden = false;
		markers[3].hidden = true;
	}
	partiControls.updateButton.onclick = _=> {
		if (partiControls.updateButton.classList.contains("disabled")) { return; }

		playSound(clickSound);
		applyParticles();
		applyRules();
	}
	partiControls.placeButton.onclick = _=> {
		placePartOnClic = !placePartOnClic;
		switchClass(partiControls.placeButton, "switchedoff");
		if (placePartOnClic) {
			canvas.style.cursor = "crosshair";
			switchClass(borraParticleButton, "disabled", true);
		}
		else { 
			canvas.style.cursor = "default"; 
			switchClass(borraParticleButton, "disabled", newParticles.length);
		}
	}

	// Creador de reglas de interacción
	ruleControls.submitButton.onclick = (event)=> {

		let returnFlag = false,
		newRuleName = ruleControls.nameInput,
		intens, qm, dmin, dmax;

		if (!ruleControls.targetSelector.options.length) {
			titilarBorde(ruleControls.targetSelector);
			returnFlag = true;
		}

		if (!ruleControls.sourceSelector.options.length) {
			titilarBorde(ruleControls.sourceSelector);
			returnFlag = true;
		}

		[intens, returnFlag] = checkAndGetNumberInput(ruleControls.intens, returnFlag);
		[qm, returnFlag] = checkAndGetNumberInput(ruleControls.qm, returnFlag);
		[dmin, returnFlag] = checkAndGetNumberInput(ruleControls.dmin, returnFlag);
		[dmax, returnFlag] = checkAndGetNumberInput(ruleControls.dmax, returnFlag);

		if (returnFlag) { return; }

		const targetIndex = ruleControls.targetSelector.selectedIndex;
		const sourceIndex = ruleControls.sourceSelector.selectedIndex;

		if (newRuleName.value) { newRuleName = newRuleName.value; } 
		else if (newRuleName.placeholder) { newRuleName = newRuleName.placeholder; }
		else { // Si no hay nombres para poner, usa el nombre estándar
			newRuleName = `${ruleControls.targetSelector.options[targetIndex].value} ← ${ruleControls.sourceSelector.options[sourceIndex].value}`;
		}
		
		if (!event.ctrlKey) { // Si es un click normal, veo si debo añadir (n) al nombre
			while (rules.some(rule => rule.ruleName == newRuleName)) { // Mientras sea nombre repetido, añade (n)

				if (/\(\d+\)$/.test(newRuleName)) {
					newRuleName = newRuleName.replace(/\((\d+)\)$/, (_, number) => {
						return "(" + (parseInt(number) + 1) + ")";
					});
		
				} else {
					newRuleName += " (1)";
				}
			}
		}

		const newRule = new Rule(
			newRuleName,
			ruleControls.targetSelector.value,
			ruleControls.sourceSelector.value,
			intens,
			qm,
			dmin,
			dmax,
		);

		cargarRule(newRule)
		
		updateUIAfterRulesChange();
		removeRuleControlsValues();
		flags.rulesModified = true;
		borraRuleButton.hidden = false;

	}
	ruleControls.updateButton.onclick = _=> {
		if (ruleControls.updateButton.classList.contains("disabled")) { return; }
		
		playSound(clickSound);
		applyRules();
	}
	ruleControls.targetSelector.onchange = _=> setPlaceholderRuleName();
	ruleControls.sourceSelector.onchange = _=> setPlaceholderRuleName();

	// Rule manager
	borraRuleButton.onclick = (event)=> {
		const indexToDelete = ruleControls.selector.selectedIndex;
		if (indexToDelete === -1) {
			console.warn("Botón borraRuleButton debería estar desactivado.")
			titilarBorde(ruleControls.selector)
			return;
		}
		
		if (event.ctrlKey) {
			rules = [];
			ruleControls.selector.innerHTML = "";
			borraRuleButton.hidden = true;
		} else {
			rules.splice(indexToDelete,1);
			ruleControls.selector.options[indexToDelete].remove();
			if (!ruleControls.selector.length) {
				borraRuleButton.hidden = true;
			}
		}
		updateUIAfterRulesChange();
		flags.rulesModified = true;
	}
	ruleControls.selector.onchange = _=> setPlaceholdersRules();

	// Particle manager
	borraParticleButton.onclick = (event)=> {
		if (borraParticleButton.classList.contains("disabled")) { return; }

		const indexToDelete = partiControls.selector.selectedIndex;
		if (indexToDelete === -1) {
			console.warn("Esto no debería haber pasado...")
			titilarBorde(partiControls.selector)
			return;
		}

		if (event.ctrlKey) {
			elementaries = [];
			partiControls.selector.innerHTML = "";
			ruleControls.targetSelector.innerHTML = "";
			ruleControls.sourceSelector.innerHTML = "";
			allParticlesDeleted();
		} else {
			elementaries.splice(indexToDelete, 1);
			partiControls.selector.options[indexToDelete].remove();
			ruleControls.targetSelector.options[indexToDelete].remove();
			ruleControls.sourceSelector.options[indexToDelete].remove();
			if (!partiControls.selector.options.length) {
				allParticlesDeleted();
			}
		}

		setPlaceholdersParticles();
		switchClass(partiControls.updateButton,"disabled", false);
		markers[2].hidden = true;
	}
	partiControls.selector.onchange = _=> setPlaceholdersParticles();

	// Parar animaciones
	CPOptions.addEventListener("animationend", function(event) { event.target.classList.remove("titilante"); });

	// Ocultar interfaces
	panelTitle.onclick = _=> hideCPOptions();
	ambientOptionsTitle.onclick = _=> switchVisibilityAttribute(ambientOptionsPanel);
	creadorPartTitle.onclick = _=> switchVisibilityAttribute(creadorPartPanel);
	creadorReglasTitle.onclick = _=> switchVisibilityAttribute(creadorReglasPanel);

	// Seed input
	seedInput.onchange = _=> setRNG(seedInput.value);
	seedInput.onclick = (event)=> {
		if (event.ctrlKey) {
			seedInput.value = seedInput.placeholder;
		}
	}
	//preloadPosButton.onclick = _=> { preloadPositions = !preloadPositions; switchClass(preloadPosButton); }

	// Canvas color
	bgColorPicker.oninput = _=> {
		styleSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1);
		if (paused) {
			const encoder = device.createCommandEncoder();
			render(encoder, Math.max(frame - 1, 0)); // -1 porque al final del loop anterior se incrementó.
			device.queue.submit([encoder.finish()]);
		}
	}

	// Particles stye 
	pStyleRange.oninput = _=> { 
		playSound(clickSound, false);
		applyParticlesStyle();
	}

	// Particle placing
	canvas.onmousedown = (ev)=> {
		if (!placePartOnClic || ev.buttons !==1) { return; }
		mouseIsDown = true;
		canvas.style.cursor = "none";
		panels.style.pointerEvents = "none";

		[mDownX, mDownY] = [ev.offsetX, ev.offsetY];

		const elem =  elementaries[partiControls.selector.selectedIndex];
		circle.style.width = elem.radio * 2 + "px";
		circle.style.backgroundColor = "rgba(" + elem.color.subarray(0, 3).map(x => x * 255) + "," + 0.6 + ")";
		
		const strx = mDownX + "px";
		const stry = mDownY + "px";

		circle.style.left = strx;
		circle.style.top =  stry;

		line.style.left = strx;
		line.style.top =  stry;
		
		arrowEnd.style.top = strx;
		arrowEnd.style.bottom = stry;
		arrowEnd.style.setProperty("--origin", "0px 0px" /*strx + " " + stry*/);

		circle.hidden = false;
	}
	canvas.onmousemove = (ev)=> {

		if (!placePartOnClic || !mouseIsDown) { 
			return;
		}
		
		if (ev.buttons !== 1) {
			mouseIsDown = false;
			circle.hidden = true;
			arrowEnd.hidden = true;
			line.hidden = true;
			panels.style.pointerEvents = "auto";
			canvas.style.cursor = "crosshair";
			return;
		}
		
		const [dx, dy] = getDeltas(ev);

		const d = Math.sqrt(dx*dx + dy*dy);
		const a = Math.atan2(dy,dx);

		line.style.width = d + "px";
		line.style.setProperty("--rot", a + "rad")

		arrowEnd.style.setProperty("--rot", a + "rad")
		arrowEnd.style.left = ev.offsetX + "px";
		arrowEnd.style.top = ev.offsetY + "px";

		arrowEnd.hidden = false;
		line.hidden = false;
	}
	canvas.onmouseup = (ev)=> {
		
		if (!placePartOnClic) { return; }
		circle.hidden = true;
		arrowEnd.hidden = true;
		line.hidden = true;
		canvas.style.cursor = "crosshair";

		if (!newParticles.length) { newParticles = Array.from(Array(elementaries.length), () => []); }

		mouseIsDown = false;
		circle.hidden = true;
		arrowEnd.hidden = true;
		panels.style.pointerEvents = "auto";

		const [dx, dy] = getDeltas(ev);

		const i = partiControls.selector.selectedIndex
		const elem = elementaries[i];

		// Revisar si entra en el canvas
		const pos = [mDownX - canvas.width/2, -(mDownY - canvas.height/2), 0, i];

		if (Math.abs(pos[0]) + elem.radio > canvas.width/2 || Math.abs(pos[1] + elem.radio > canvas.height/2)) {
			return;
		}

		// Agregar partícula a elementaries

		// Escalar el módulo del vector velocidad linealmente y luego exponencialmente.
		const fac = 1/30;
		const exp = 1.4;
		const [x, y] = [dx*fac, dy*fac];
		const s = (x*x + y*y)**((exp-1)/2); 
		const vel = [x*s, -y*s, 0, 1];

		const n = ++elem.cantidad * 4;
		const newPos = new Float32Array(n);
		const newVel = new Float32Array(n);

		newPos.set(elem.posiciones);
		newPos.set(pos, n-4);
		newVel.set(elem.velocidades);
		newVel.set(vel, n-4);
		elem.posiciones = newPos;
		elem.velocidades = newVel;

		// Agregar a lista temporal para pasar al GPUBuffer
		newParticles[i].push([pos, vel]);
		
		// Si está pausado, dibujar preview temporal con HTML y CSS. En lugar de eso podría pasarse al GPUBuffer y renderizar.
		if (paused) {
			const newPartC = circle.cloneNode(false);
			const id = newParticles.flat().length/2;
			newPartC.id = "newpartc" + id;

			if (dx || dy) {
				const newPartL = line.cloneNode(false);
				newPartL.id = "newpartl" + id;
				newPartL.style.setProperty("--alpha", "0.2")
				tempParticles.appendChild(newPartL);	
				newPartL.hidden = false;
			}
			tempParticles.appendChild(newPartC);
			newPartC.hidden = false;
		}

		partiControls.cantInput.placeholder = elem.cantidad;

		// Levantar flags
		flags.updateSimParams = true;
		flags.updateParticles = true;
		//flags.resetParts = false;
	}

	// Botón de info debug
	infoButton.onclick = _=> switchVisibilityAttribute(infoPanel);

	// Botón de export e import
	exportButton.onclick = (event)=> exportarSetup(
		new Setup(
			"Manualmente exportado",
			seedInput.value,
			{
				friction: parseFloat(ambientControls.inputs.friction.placeholder),
				bounce: parseInt(ambientControls.inputs.bounce.placeholder),
				maxInitVel: parseFloat(ambientControls.inputs.vel.placeholder),
				canvasDims: [canvas.width, canvas.height],
			},
			elementaries,
			rules
		),
		"Cells GPU setup",
		!!event.ctrlKey
	);
	importButton.onclick = _=> {
		importSetup()
		.then( (setup) => { cargarSetup(setup, true); } );
	}

	// Sonidos
	volumeRange.onchange = _=> {
		clickSound.volume = `${volumeRange.value * !muted}`;
		playSound(clickSound);
	}
	panels.onclick = (event)=> {
		if (event.target.tagName === "BUTTON" && !event.target.classList.contains("disabled")) {
			playSound(clickSound);
		}
	}

	// Opciones del ambiente/simulación
	function enableIfChanged(inputs) {
		let allFieldsEmpty = true;
		for (const input in inputs) {
			if (inputs[input].value) {
				allFieldsEmpty = false;
				break;
			}
		}
		switchClass(ambientControls.updateButton, "disabled", allFieldsEmpty);
		markers[1].hidden = allFieldsEmpty;
	}
	for (const input in ambientControls.inputs) {
		ambientControls.inputs[input].onchange = _=> enableIfChanged(ambientControls.inputs);
	}
	ambientControls.inputs.bounce.oninput = _=> setAutomaticInputElementWidth(ambientControls.inputs.bounce, 3, 12, 0);
	ambientControls.updateButton.onclick = _=> {
		if (ambientControls.updateButton.classList.contains("disabled")) { return; }
		playSound(clickSound);
		applyAmbient();
	}
//

// INICIALIZACIÓN
	// Interfaz

	if (SHOW_DEBUG) { switchVisibilityAttribute(debugInfo); }
	// Novedades
	if (LAST_VISITED_VERSION !== CURRENT_VERSION) {

		newsText.innerText = CHANGELOG;
		newsDialog.open = true;

		dialogOk2Button.onclick = _=> {
			localStorage.setItem("STORED_VERSION_NUMBER", "_" + CURRENT_VERSION);
			newsDialog.open = false;
		}
		dialogNVM2Button.onclick = _=> {
			localStorage.setItem("STORED_VERSION_NUMBER", CURRENT_VERSION); //CURRENT_VERSION
			newsDialog.open = false;
		}
	}
	// Diálogo de ayuda
	if ((NEW_USER === "1"|| NEW_USER === null)) {
	
		helpDialog.open = true;
		
		dialogOkButton.onclick = _=> {
			localStorage.setItem("NEW_USER", 1);
			helpDialog.open = false;
		}
		dialogNVMButton.onclick = _=> {
			localStorage.setItem("NEW_USER", 0);
			helpDialog.open = false;
		}
	}
	// Tamaño canvas y sonido
	canvasInfo.innerText = `${canvas.width} x ${canvas.height} (${(canvas.width/canvas.height).toFixed(6)})`;
	clickSound.volume = volumeRange.value;
	// Valores por defecto
	ambientControls.inputs.friction.placeholder = ambient.friction.toFixed(3);
	ambientControls.inputs.bounce.placeholder = ambient.bounce;
	ambientControls.inputs.vel.placeholder = ambient.maxInitVel;

	// Inicializar seed o importar
	switch (STARTING_SETUP_NUMBER) {
		case 0:
			setRNG(seedInput.value);
			break;
		case 1:
			cargarSetup(generarSetupClásico(10, ""), false); //"0.6452130" x10
			break;
		case 2:
			const path = SETUPS_FOLDER + SETUP_FILENAME + ".json";
			importSetup(path)
			.then( (setup) => { cargarSetup(setup, false);} );
			break;
		case 3: 
			generarSetupDebug(10, "");
			break;
	}
//

// INICIALIZAR WEBGPU

	// Vértices
	const v = 1; // ojo!: afecta el shader
	const vertices = new Float32Array([ // Coordenadas en clip space
		//   X,    Y,
		-v, -v, // Triangle 1 (Blue)
		v, -v,
		v,  v,

		-v, -v, // Triangle 2 (Red)
		v,  v,
		-v,  v,
	]);
	const vertexBuffer = device.createBuffer({
		label: "Particle vertices",
		size: vertices.byteLength, //12 * 32-bit floats (4 bits c/u) = 48 bytes
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);
	
	const vertexBufferLayout = {
		arrayStride: 8, 			// cada vertex ocupa 8 bytes (2 *4-bytes)
		attributes:[{ 				// array que es un atributo que almacena cada vertice (BLENDER!!!)
			format: "float32x2", 	// elijo el formato adecuado de la lista de GPUVertexFormat
			offset: 0, 				// a cuántos bytes del inicio del vertice empieza este atributo.
			shaderLocation: 0, 		// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
		}]
	};


	// texture y su view, para multisampling (MSAA)
	if (!textureView) { textureView = getTextureView(ambient.canvasDims); }

	const renderPassDescriptor = {	// Parámetros para el render pass que se ejecutará cada frame
		colorAttachments: [{		// es un array, de momento sólo hay uno, su @location en el fragment shader es entonces 0
			view: textureView,
			resolveTarget: context.getCurrentTexture().createView(), // para multisampling. Sin él, view sería esto.
			loadOp: "clear",
			clearValue: styleSettings.bgColor,
			storeOp: "store",
		}]
	};

	// Shaders

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader(),
	});
	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader(WORKGROUP_SIZE),
	})

	let distancesShaderModule;
	if (PRECALCULAR_DISTANCIAS) {
		distancesShaderModule = device.createShaderModule({
			label: "Distances compute shader",
			code: computeDistancesShader(WORKGROUP_SIZE, Nd), // Falta actualizar la toma de Nd en shader
		})
	}

	// Bind groups

	let bindGroups = []; // updateSimulationParameters los actualiza.
	const bindGroupLayoutPos = device.createBindGroupLayout({
		label: "Positions Bind Group Layout",
		entries: [{
			binding: 0, // Entrada. Siempre voy a renderizar éste.
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
			binding: 0, // Parámetros de longitud fija
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
			buffer: { type: "uniform"}
		}, {
			binding: 1, // velocidades
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" } // Initial state input buffer
		}, {
			binding: 2, // reglas
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "read-only-storage"}
		}, {
			binding: 3, // distancias
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}, {
			binding: 4, // Datos elementaries (cantidades, radio, color)
			visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 5,	// datos interacciones
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "uniform" }
		}]
	});

	/*const bindGroupLayoutDist = device.createBindGroupLayout({
		label: "distances comp bind groups layout",
		entries: [{
			binding: 0,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {}
		},]
	})*/

	// Pipelines

	const pipelineLayout = device.createPipelineLayout({
		label: "Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto],
	}); // El orden de los bind group layouts tiene que coincider con los atributos @group en el shader

	/*const pipelineLayout2 = device.createPipelineLayout({
		label: "Pipeline Layout 2",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto, bindGroupLayoutDist ],
	});*/

	const renderPipelineDescriptor = {
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
		},
		multisample: {
			count: sampleCount, // default 1
		}
	}

	const simulationPipelineDescriptor = {
		label: "Simulation pipeline",
		layout: pipelineLayout,
		compute: {
			module: simulationShaderModule,
			entryPoint: "computeMain",
			constants: { // es una entrada opcional, acá puedo poner valores que usará el compute shader
				//constante: 1, // Así paso el workgroup size al compute shader
			},
		},
	}

	let simulationPipeline2Descriptor;
	if (PRECALCULAR_DISTANCIAS) {
		simulationPipeline2Descriptor = {
			label: "Distances pipeline",
			layout: pipelineLayout,
			compute: {
				module: distancesShaderModule,
				entryPoint: "computeMain",
			},
		}
	}

	// Crear render pipeline (para usar vertex y fragment shaders)
	const particleRenderPipeline = device.createRenderPipeline(renderPipelineDescriptor);

	// Crear compute pipelines
	const simulationPipeline = device.createComputePipeline(simulationPipelineDescriptor);

	let simulationPipeline2;
	if (PRECALCULAR_DISTANCIAS) {
		simulationPipeline2 = device.createComputePipeline(simulationPipeline2Descriptor);
	}

	// Buffers

	// Parámetros de longitud fija (por lo tanto buffers de size fijo)

	const paramsBufferSize = 8 + 4 + 4 + 4 + 4 + 4 + 8 + 8 + 4 + 16;
	// [canvasDims], N, Ne, Nr, Nd, Npi, [frictionInv, bounceF], [borderStart, spherical], padding, [4 RNGSeeds]
	const paramsArrBuffer = new ArrayBuffer(paramsBufferSize);

	const paramsArrays = {
		canvasDims: new Float32Array(paramsArrBuffer, 0, 2), // offset en bytes, longitud en cant de elementos
		N: new Uint32Array(paramsArrBuffer, 8, 1),		//  Cantidad total de partículas
		Nr: new Uint32Array(paramsArrBuffer, 16, 1),	//  Cantidad de reglas activas (que involucran elementaries cargados)
		Nd: new Uint32Array(paramsArrBuffer, 20, 1),	//  Cantidad total de distancias a precalcular (si habilitado)
		Ne: new Uint32Array(paramsArrBuffer, 12, 1),	//  Cantidad de elementaries
		Npi: new Uint32Array(paramsArrBuffer, 24, 1),	//  Cantidad de pares de interacción distintos 
		ambient: new Float32Array(paramsArrBuffer, 28, 2),	// Parámetros de entorno
		pStyle: new Float32Array(paramsArrBuffer, 36, 2),	// Estilo visual de las partículas
		// 4 bytes of padding
		seeds: new Float32Array(paramsArrBuffer, 48, 4),	// Seed para el rng en los shaders
	}

	const GPUBuffers = {
		params: device.createBuffer({
			label: "Params buffer",
			size: paramsBufferSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
	};

//

// Funciones importantes

function editBuffers() {

	let msg = "";

	// Canvas size
	if (flags.updateCanvas) {
		writeCanvasToBuffer();
		msg += "canvas/";
	}

	// Entorno
	if (flags.editAmbient) {
		writeAmbientToBuffer();
		msg += "ambient/";
	}

	// Datos elementaries, posiciones y velocidades
	if (flags.updateParticles) {
		updateParticlesBuffers();
		msg += "posivels/";
	}

	// Reglas
	if (flags.updateRules) {
		const [activeRules, Nr, m] = updateActiveRules(); // Reglas parte A
		updateDistancesBuffers(Nr, m); // Distancias
		updateRulesBuffer(activeRules); // Reglas parte B
		msg += "rules/";
	}

	// Estilo
	if (flags.editPStyle) {
		writePStyleToBuffer();
		msg += "pstyle/";
	}

	if (!msg) { console.warn("No se editó ningún buffer."); }
	return msg.slice(0,-1);
}

function updateSimulationParameters() {

	setRNG(seedInput.value);

	// CREACIÓN DE BUFFERS
	const msg = editBuffers();

	if (N === 0) { flags.updateSimParams = false; return;}

	// Shaders pueden ir acá

	// Bind groups 

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
			entries: [
				{
					binding: 0,	// Parámetros de longitud fija
					resource: { buffer: GPUBuffers.params } // los resources admiten más parametros (offset, size)
				}, {
					binding: 1,
					resource: { buffer: GPUBuffers.velocities }
				}, {
					binding: 2,
					resource: { buffer: GPUBuffers.rules }
				}, {
					binding: 3,
					resource: { buffer: GPUBuffers.distancias }
				}, {
					binding: 4,
					resource: { buffer: GPUBuffers.datosElementaries }
				}, {
					binding: 5,
					resource: { buffer: GPUBuffers.datosInteracciones }
				}
			],
		}),
		/*device.createBindGroup({
			label: "Distances computation bindgroup",
			layout: bindGroupLayoutDist,
			entries: [{
				binding: 0,
				resource: { buffer: GPUBuffers.EXAMPLEBUFFER}
			},]
		})*/
	];

	// Pipelines pueden ir acá

	// Actualizar workgroup counts para compute passes
	workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	workgroupCount2 = Math.ceil(Nd / WORKGROUP_SIZE);
	//console.log( `N / workgroup size: ${N} / ${WORKGROUP_SIZE} = ${N/WORKGROUP_SIZE}\nworkgroup count: ${workgroupCount}`);

	console.log("Updated sim params: " + msg + ".");
	flags.updateSimParams = false;
}

// Funciones para el loop principal

function render(encoder, frame) {
	// Actualizar color de fondo.
	renderPassDescriptor.colorAttachments[0].clearValue = styleSettings.bgColor; 

	// Actualizar matriz de proyección

	if (sampleCount > 1) {
		renderPassDescriptor.colorAttachments[0].view = textureView;
		renderPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
	} else {
		renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
		renderPassDescriptor.colorAttachments[0].resolveTarget = undefined;
	}
	
	const pass = encoder.beginRenderPass(renderPassDescriptor);
	if (N) {
		pass.setPipeline(particleRenderPipeline);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.setBindGroup(0, bindGroups[frame % 2]);
		pass.setBindGroup(1, bindGroups[2]);
		pass.draw(vertices.length /2, N);	// 6 vertices. renderizados N veces
	}
	pass.end(); // finaliza el render pass
}

function computeNextFrame(encoder, frame) {
	if (N) { // Aunque no haya reglas activas, las partículas pueden estar moviéndose. Hay que calcular su pos.

		if (PRECALCULAR_DISTANCIAS) {
			// Calcular distancias
			const computePass2 = encoder.beginComputePass();
			computePass2.setPipeline(simulationPipeline2);
			computePass2.setBindGroup(0, bindGroups[frame % 2]); // posiciones alternantes
			computePass2.setBindGroup(1, bindGroups[2]);
			//computePass2.setBindGroup(2, bindGroups[3]);	// bind groups exclusivos para calcular las distancias
			computePass2.dispatchWorkgroups(workgroupCount2, 1, 1);
			computePass2.end();
		}

		timestamp(2, encoder); // Compute dist

		writeRNGSeedToBuffer();
		
		// Calcular simulación (actualizar posiciones y velocidades)
		const computePass = encoder.beginComputePass();
		computePass.setPipeline(simulationPipeline);
		computePass.setBindGroup(0, bindGroups[frame % 2]); // posiciones alternantes
		computePass.setBindGroup(1, bindGroups[2]); // lo demás
		/* El compute shader se ejecutará N veces. El workgroup size es 64, entonces despacho ceil(N/64) workgroups, todos en el eje x. */
		computePass.dispatchWorkgroups(workgroupCount, 1, 1); // Este vec3<u32> tiene su propio @builtin en el compute shader.
		computePass.end();

	} else {timestamp(2, encoder);}  // render - compute all (=0)
}

// ANIMATION LOOP

async function newFrame() {

	if (paused && !stepping) { return; }

	if ( flags.updateSimParams ){	// Rearmar buffers y pipeline
		updateSimulationParameters();
	}

	const encoder = device.createCommandEncoder();

	timestamp(0, encoder);

	render(encoder, frame); 

	timestamp(1, encoder);

	computeNextFrame(encoder, frame);

	timestamp(3, encoder);

	device.queue.submit([encoder.finish()]);


	if ( false && (frame % 60 === 30)) {

		const values = new Float32Array(await readBuffer(device, GPUBuffers.velocities));
		
		const values2 = [];
		for (let i=3; i<values.length; i += 4) { values2.push(values[i]); } // read the w component of velocities
		//generateHistogram2(values2, 0.6, 10);
		
		console.log(values2[0]);
		//console.log(values[2]);
		//console.log(values[0]);
	}
	
	if (frame % 30 === 0) {	// Leer el storage buffer y mostrarlo en debug info (debe estar después de encoder.finish())
		let dif1, dif2, dif3, text = "";
		if (timer) {
			const arrayBuffer = await readBuffer(device, queryBuffer);
			const timingsNanoseconds = new BigInt64Array(arrayBuffer);
			dif1 = (Number(timingsNanoseconds[1]-timingsNanoseconds[0])/1_000_000);
			dif2 = (Number(timingsNanoseconds[2]-timingsNanoseconds[1])/1_000_000);
			dif3 = (Number(timingsNanoseconds[3]-timingsNanoseconds[2])/1_000_000);
		} else {
			dif1 = (t[1] - t[0]);
			dif2 = (t[2] - t[1]);
			dif3 = (t[3] - t[2]);
			text +="⚠ GPU Timing desact.\n"
		}
		text += `Draw: ${dif1.toFixed(3)} ms\
				\nCompute 1: ${dif2.toFixed(3)} ms\
				\nCompute 2: ${dif3.toFixed(3)} ms\
				\nCompute T: ${(dif2+dif3).toFixed(3)} ms`;
		
		if (dif1 + dif2 + dif3 > 30) {
			text += "\nGPU: Brrrrrrrrrrr";
		}
		displayTiming.innerText = text;
	}

	frame++; frameCounter++;
	ageInfo.innerText = frame; // "Edad = frame drawn on screen + 1"

	const timeNow = performance.now();
	if (timeNow - refTime >= 1000) {
		fps = frameCounter;
		frameCounter = 0;
		refTime = timeNow;
		fpsInfo.innerText = fps;
	}

	if ( !stepping ) { animationId = requestAnimationFrame(newFrame); }
}

//TODO:
/*
PERMITIR APLICAR PARTÍCULAS SIN RESETEAR POSIVELS. WE HAVE THE TECHNOLOGY!
*/
/* Ctrl + Arrastrar para colocar un trazo de partículas*/
/* Pasar los parámetros pertinentes mediante writebuffer en lugar de recrear nuevos buffers */
/* Funciones para quitar o agregar partículas. permite mergers/eaters */
/* Antialiasing / renderizar a mayor resolución */
/* Fondo con efectos con shader */
