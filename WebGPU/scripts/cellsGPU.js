import { inicializarCells } from "inicializar-webgpu";
import { renderShader, computeShader, computeDistancesShader } from "shaders";

// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf

const 
[device, canvas, canvasFormat, context, timer] = await inicializarCells(false),

WORKGROUP_SIZE = 64,
SAMPLE_SETUP = {
	seed: "sampleSeed",
	friction: "0.0",
	bounce: "10",
	maxInitVel: "0.0",
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
},
NEW_USER = localStorage.getItem("NEW_USER"),
CURRENT_VERSION = document.getElementById("title").innerText,
LAST_VISITED_VERSION = localStorage.getItem("STORED_VERSION_NUMBER"),
CHANGELOG = `\
	${CURRENT_VERSION}

	* Objetivo primario del proyecto completado, y por eso ya salimos de Beta! Contale a tus amigos!

	* Si encontrás algún bug avisame porfa. No le cuentes a tus amigos!

	* Más QoL en las opciones. Partículas ahora con relieve esférico y pequeñas variaciones de color.
	Nuevas opciones: Entorno. Colocación manual de partículas en desarrollo.
	Rework del manejo de buffers de WebGPU, para hacerlo más flexible. Falta todavía más.
	Un cambio sin identificar redujo el rendimiento un 50%, pero una optimización en los shaders lo\
	aumentó un 100% así que no problem!
	Planeando más features y mejoras si tengo tiempo.

	* Mejora en el sistema de colisiones: ahora deberían ser más precisas a altas velocidades.

	* Esto debería aparecer cada vez que publico una nueva versión. Para ello estoy usando un par de bytes\
	en tu equipo. Desde ya muchas gracias. No, no te los devuelvo.
`,
uiSettings = {
	bgColor : [0, 0, 0, 1],
},
ambient = {
	friction: 1 - 0.995, // 0.995 en el shader
	bounce: 80, // 0.8 en el shader
	maxInitVel: 0,
};

let 
N = 0, 	// cantidad total de partículas
elementaries = [], // cada elemento es un objeto que almacena toda la info de una familia de parts.
rules = [],   // cada elemento es una regla, formada por un objeto que la define.
workgroupCount,		// workgroups para ejecutar reglas de interacción
workgroupCount2, 	// worgroups para calcular distancias entre partículas
rng,
frame = 0, // simulation steps
animationId,
paused = true,
listaInteracciones = [],
updatingParameters = true,
resetPosiVels = true,
editingBuffers = true,
editingAmbient = false,
stepping = false,
muted = false,
fps = 0,
frameCounter = 0,
refTime,
//preloadPositions = false, // CODE 0
placePartOnClic = false,
cargarPosiVelsAlBuffer;


// TIMING & DEBUG 
	const START_WITH_SETUP = 1
	const SHOW_DEBUG = 0
	//localStorage.setItem("NEW_USER", 1);
	//localStorage.setItem("STORED_VERSION_NUMBER", 1);
	const debugSetup = "Cells q tests.json";
	let PRECALCULAR_DISTANCIAS = false;
	let debug = false;
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

// FUNCIONES VARIAS - TODO: Modularizar

	function setRNG(seed) {
		//console.log(`setRNG(${seed}) called`)
		if (seed == "") {
			seed = Math.random().toFixed(7).toString();
		}
		rng = new alea(seed);
		seedInput.placeholder = seed;
	}
	function hexString_to_rgba(hexString, a) {
		
		hexString = hexString.replace("#",""); // remove possible initial #

		const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
		const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
		const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

		// console.log(`Returned RGBA array [${[red, green, blue, a]}] from "#${hexString}" [hexString_to_rgba] `);

		return new Float32Array([red, green, blue, a]); // Store the RGB values in an array
	}
	function randomPosition(margin = 0) {
		return new Float32Array([
			(rng() - 0.5) * (canvas.width - margin), // TODO: así como está es eficiente pero el margen no es el esperado
			(rng() - 0.5) * (canvas.height - margin),
			0,
			1
		]);
	}
	function randomVelocity() {
		return new Float32Array([
			(2 * rng() - 1) * ambient.maxInitVel,
			(2 * rng() - 1) * ambient.maxInitVel,
			0,
			1,
		]);
	}
	function crearPosiVel(n, margin = 0, debug = false) { // crea dos n-arrays con las posiciones y velocidades de n partículas

		const buffer = new ArrayBuffer(n * 8 * 4) // n partículas, cada una tiene 28B (4*4B para la pos y 3*4B para la vel)

		const pos = new Float32Array(buffer, 0, n*4); // buffer al que hace referencia, byte offset, number of elements. [x1, y1, z1, w1, x2, y2, ...]
		const vel = new Float32Array(buffer, n*4*4, n*4);

		for (let i=0 ; i < n*4 ; i += 4) {
			[ pos [i], pos[i+1], pos [i+2], pos[i+3] ] = randomPosition(margin); // randomPosition devuelve un array [x,y,z,w]
			[ vel [i], vel[i+1], vel [i+2], vel[i+3] ] = randomVelocity();
		}
		if (debug) {
			for (let i=0 ; i < n*4 ; i += 4) {
				[ pos [i], pos[i+1], pos [i+2], pos[i+3] ] = [ (i/4) * canvas.width / (n-1) - canvas.width/2, ((i/4)*20 - canvas.height/2)*0, 0, 1];
			}
		}
		/*
		for (let i=0 ; i < n*3 ; i += 3) {
			[ vel [i], vel[i+1], vel [i+2] ] = randomVelocity() // randomVelocity devuelve un array [x,y,z]
		}
		*/
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
	function crearElementary(nombre, color, cantidad, radio, posiciones, velocidades) {
		if ( 
			typeof nombre === "string" && 
			color.constructor === Float32Array && color.length === 4 &&
			Number.isInteger(cantidad) && cantidad >= 0 &&
			typeof radio === "number" && radio >= 0  &&
			(posiciones.constructor === Float32Array || (Array.isArray(posiciones) && posiciones.length === 0) ) && 
			(velocidades.constructor === Float32Array || (Array.isArray(velocidades) && velocidades.length === 0) )
		) {
			return {
				nombre,			// string
				color,  		// vec4f    (orig. string like "#000000")
				cantidad,		// integer (originalmente string)
				radio,			// float   (originalmente string)
				posiciones,		// [x,y,z,w]
				velocidades,	// [x,y,z,w]
			};
		}

		throw new Error("Detectado parámetro inválido");

	}
	function cargarElementary(newElementary) {
		let i = elementaries.length;
		if ( elementaries.some(dict => dict.nombre == newElementary.nombre) ){
			console.log("Reemplazando partículas homónimas...")
			i = elementaries.findIndex(dict => dict.nombre == newElementary.nombre);
			elementaries [i] = newElementary;
		} else {
			elementaries.push(newElementary);
			actualizarElemSelectors(newElementary); // actualizar lista de nombres en el creador de reglas de interacción
		}
		partiControls.selector.selectedIndex = i;
	}
	function cargarRule(newRule) {
		let i = rules.length;
		if ( rules.some(dict => dict.ruleName === newRule.ruleName) ){
			console.log("Reemplazando regla homónima...")
			i = rules.findIndex(dict => dict.ruleName === newRule.ruleName);
			rules[i] = newRule;
		} else {
			rules.push( newRule );
			actualizarRuleSelector(newRule); // actualizar lista de nombres en el creador de reglas de interacción
		}
		ruleControls.selector.selectedIndex = i;
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
	function exportarSetup(elementariesI, rules, seed, filename = "Cells GPU setup", guardarPosiVel = false) {

		let elementaries = elementariesI;
		if (guardarPosiVel) {
			console.log("Exportando con posiciones y velocidades")
			for (let elem of elementaries) {
				elem.posiciones = Array.from(elem.posiciones); //console.log(elementaries[1].posiciones);
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
		
		const setup = {
			seed,
			friction: ambientControls.frictionInput.placeholder,
			bounce: ambientControls.bounceInput.placeholder,
			maxInitVel: ambientControls.velInput.placeholder,
			elementaries,
			rules,
		};
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
	function importarJson() {
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
		}
		);
	}
	function cargarSetup(setup, debug = false) {  // reemplaza el setup actual. Rellena aleatoriamente posiciones y velocidades
		if (!hasSameStructure(setup, SAMPLE_SETUP)) { throw new Error("Falló la verificación, no es un objeto tipo setup")}
		vaciarSelectors();

		setRNG(setup.seed);
		if (setup.seed) {
			seedInput.value = setup.seed;
		}

		ambientControls.frictionInput.value = setup.friction;
		ambientControls.bounceInput.value = setup.bounce;
		ambientControls.velInput.value = setup.maxInitVel;

		elementaries = setup.elementaries;
		rules = setup.rules;
		let i = 0;
		for (let elem of elementaries) {
			const L = elem.cantidad*4;
			const posiVelsIncompleto = (elem.posiciones.length !== L || elem.velocidades.length !== L);

			if (/*preloadPositions &&*/ posiVelsIncompleto) { // si faltan posiVels /*y PP está activado*/, crearlas. 
				console.log(`Import: Creando posiVels para ${elem.nombre}.`);
				const [pos, vel] = crearPosiVel(elem.cantidad, elem.radio * 2, debug);
				elem.posiciones = pos;
				elem.velocidades = vel;
			} else {
				elem.posiciones = new Float32Array(setup.elementaries[i].posiciones);
				elem.velocidades = new Float32Array(setup.elementaries[i].velocidades);
				cargarPosiVelsAlBuffer = true;
			}
			/*
			if (!posiVelsIncompleto) { // si tiene todas las posiVels, indicar que se tomen al reiniciar.
				preloadPositions = true;
				switchClass(preloadPosButton, true);
			}*/
			elem.color = new Float32Array(elem.color);
			actualizarElemSelectors(elem);
			i++;
		}
		if (elementaries.length) {partiControls.placeButton.hidden = false;}

		for (let rule of rules) {
			actualizarRuleSelector(rule);
		}
		aplicarAmbiente();
		setPlaceholdersParticles();
		setPlaceholdersRules();
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
	function removeOptions(htmlElement) { 
		htmlElement.options.length = 0; //<- only for select elements
		//htmlElement.innerHTML = "";
		//while (htmlElement.firstChild) {
		//	htmlElement.removeChild(htmlElement.firstChild);
			//htmlElement.remove(0) <- only for select elements
		//}
		//$(htmlElement).children().remove();
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
	function generarSetupClásico(m, seed, conReglas=true, debug = false) {
		const e = new Float32Array([]);
		let elementaries = [];
		elementaries = [
			crearElementary("A", new Float32Array([1,1,0,1]), 300*m, 3, e, e), //300
			crearElementary("R", new Float32Array([1,0,0,1]), 80*m, 4, e, e),	//80
			crearElementary("P", new Float32Array([147/255,112/255,219/255,1]), 30*m, 5, e, e),	//30
			crearElementary("V", new Float32Array([0,128/255,0,1]), 5, 7, e, e),				//5 r7
		];

		if (debug) {
			elementaries = [
				crearElementary("yellow", new Float32Array([1,1,0,1]), 5, 8, e, e), //300 r3
				//crearElementary("red", new Float32Array([1,0,0,1]), 4, 4, e, e),	//80
				//crearElementary("purple", new Float32Array([147/255,112/255,219/255,1]), 3, 5, e, e),	//30
				//crearElementary("green", new Float32Array([0,128/255,0,1]), 2, 7, e, e),				//5 r7
			];
		}
		/*q = 0.25 * g_clásico * q_clásico. q_clásico = [0.2, 0, 1, 0, 1, 0, 1, 0, 0.2] */
		let rules = [];
		if (conReglas) {
			rules = [ //  nom/tar/src /I    /q    /dmin/dmax
				crearRule("","R","R",  0.5, 0.025, 15,	100 ), 	// los núcleos se tratan de juntar si están cerca
				crearRule("","A","R",  0.5, 0.0,   60,	600 ), 	// los electrones siguen a los núcleos, pero son caóticos
				crearRule("","A","A", -0.1, 0.025, 20,	600 ),
				crearRule("","P","R",  0.4, 0.0,   0.1, 150 ), 	// los virus persiguen a los núcleos
				crearRule("","P","A", -0.2, 0.05,  0.1, 100 ),	// los virus son repelidos por los electrones
				crearRule("","A","P",  0.2, 0.0,   0.1, 100 ), 	// los electrones persiguen a los virus
				crearRule("","R","P",  1.0, 0.25,  0.1, 10  ), 	// los virus desorganizan los núcleos
				crearRule("","R","V",  0.3, 0.0,   50,  1000), 	// los núcleos buscan comida
				crearRule("","V","V", -0.2, 0.01,  50,  200 ), 	// la comida se mueve un poco y estabiliza las células
			];
		}

		const setup = {
			seed,
			friction: "0.005",
			bounce: "80",
			maxInitVel: "0",
			elementaries,
			rules
		};
		cargarSetup(setup, debug)
		console.log("Setup clásico cargado!")
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
	function setPlaceholdersParticles() {
		const i = partiControls.selector.selectedIndex;
		if (i === -1) {return;}
		partiControls.nameInput.placeholder = elementaries[i].nombre ?? "";
		partiControls.colorInput.value = rgba_to_hexString(elementaries[i].color);
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
	function titilarBorde(element, color="red") {
		element.classList.add("titilante");
		element.style.setProperty("--titil-color", color);
	}
	function sqMatVal(m, f, c) {
		const numCols = Math.sqrt(m.length);
		return m[f * numCols + c]
	}
	function switchClass(element, state) {
		// por defecto lo switchea. Si tiene una input, lo pone acorde a ella. Devuelve el estado.

		const className = "switchedoff";
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
	function switchVisibility(element) {
		element.hidden ^= true;
	}
	function hideCPOptions() { 
		CPOptions.hidden ^= true;
		if (CPOptions.hidden){ panelTitle.style = "height: 3ch;"; } else { panelTitle.style = ""; }
	}
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
	function resetear() {
		aplicarAmbiente();
		updatingParameters = true;
		editingBuffers = true;
		resetPosiVels = true;
	}
	function playSound(soundElement) { 
		if (soundElement.currentTime > 0.05) { // evitar spam
			soundElement.currentTime = 0; 
		}
		soundElement.play(); 
	};
	function timestamp(i, encoder) {

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
	async function readBuffer(device, buffer) {
		const size = buffer.size;
		const gpuReadBuffer = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const copyEncoder = device.createCommandEncoder();
		copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);
		device.queue.submit([copyEncoder.finish()]);
		await gpuReadBuffer.mapAsync(GPUMapMode.READ);
		return gpuReadBuffer.getMappedRange();
	}
	function setAutomaticInputElementWidth (inputElement, min, max, padding) {
		// falla para xxxxe porque allí value = "" -> length = 0

		if (inputElement.validity.badInput) {return;}

		const ancho = Math.max(inputElement.value.length, inputElement.placeholder.length);
		inputElement.style.width = `${ Math.min(Math.max(ancho, min) + padding, max) }ch`;
	}
	function writeAmbientToBuffer() {
		ambientArr.set([1 - ambient.friction, ambient.bounce / 100]);
		device.queue.writeBuffer(paramsBuffer, 28, paramsArrBuffer, 28, 8); 
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
	function aplicarAmbiente() {
		let mustUpdate = false;
		const [friction, frictionInvalid] = checkAndGetNumberInput(ambientControls.frictionInput, false, false);
		
		if (!frictionInvalid) {
			ambientControls.frictionInput.value = "";
			if (ambient.friction != friction) {
				ambient.friction = friction;
				ambientControls.frictionInput.placeholder = friction;
				mustUpdate = true;
			}
			
		}
		const [bounce, bounceInvalid] = checkAndGetNumberInput(ambientControls.bounceInput, false, false);
		if (!bounceInvalid) {
			ambientControls.bounceInput.value = "";
			if ( ambient.bounce != Math.max(bounce, 0)) {
				ambient.bounce = Math.max(bounce, 0);
				ambientControls.bounceInput.placeholder = ambient.bounce;
				mustUpdate = true;
				setAutomaticInputElementWidth(ambientControls.bounceInput, 3, 12, 0);
			}
		}
		const [vel, velInvalid] = checkAndGetNumberInput(ambientControls.velInput, false, true);
		if (!velInvalid) {
			ambientControls.velInput.value = "";
			if ( vel != ambient.maxInitVel) {
				ambient.maxInitVel = vel;
				ambientControls.velInput.placeholder = vel;
				mustUpdate = true
			}
		}

		if (mustUpdate) {editingAmbient = true;}
	}
//

// ELEMENTOS HTML

	const
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
	// opciones
	pauseButton = document.getElementById("pausebutton"),
	stepButton = document.getElementById("stepbutton"),
	resetButton = document.getElementById("resetbutton"),

	seedInput = document.getElementById("seed"),
	//preloadPosButton = document.getElementById("preloadPositions"), CODE 0

	bgColorPicker = document.getElementById("bgcolorpicker"),

	volumeRange = document.getElementById("volume"),
	clickSound = document.getElementById("clicksound"),

	ambientOptionsTitle = document.getElementById("ambientoptionstitle"),
	ambientOptionsPanel = document.getElementById("ambientoptions"),
	ambientControls = {
		frictionInput: document.getElementById("friction"),
		bounceInput: document.getElementById("bounce"),
		velInput: document.getElementById("initialvel"),
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
	line = document.getElementById("line");
//

// EVENT HANDLING

	// Parar animaciones
	CPOptions.addEventListener("animationend", function(event) { event.target.classList.remove("titilante"); });

	// Ocultar interfaces
	panelTitle.onclick =_=> hideCPOptions();
	ambientOptionsTitle.onclick =_=> switchVisibility(ambientOptionsPanel);
	creadorPartTitle.onclick =_=> switchVisibility(creadorPartPanel);
	creadorReglasTitle.onclick =_=> switchVisibility(creadorReglasPanel);

	// Seed input
	seedInput.onchange =_=> setRNG(seedInput.value);
	seedInput.onclick =(event)=> {
		if (event.ctrlKey) {
			seedInput.value = seedInput.placeholder;
		}
	}
	//preloadPosButton.onclick =_=> { preloadPositions = !preloadPositions; switchClass(preloadPosButton); }

	// Canvas color
	bgColorPicker.onchange =_=> { uiSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1); }


	function getCoords(ev) {
		const canvasPos = canvas.getBoundingClientRect();
		return [ev.offsetX + canvasPos.x - 8, ev.offsetY]
	}
	let mDownCanvasX = 0;
	let mDownCanvasY = 0;
	let mouseIsDown = false;
	let particulasQueActualizar = [];
	// Canvas dragging
	canvas.onmousedown = (ev)=> {
		if (!placePartOnClic || ev.buttons !==1) { return; }
		mouseIsDown = true;
		canvas.style.cursor = "none";
		panels.style.pointerEvents = "none";

		[mDownCanvasX, mDownCanvasY] = getCoords(ev);

		const elem =  elementaries[partiControls.selector.selectedIndex];
		circle.style.width = elem.radio * 2 + "px";
		circle.style.backgroundColor = "rgba(" + elem.color.subarray(0, 3).map(x => x * 255) + "," + 0.6 + ")";
		
		const strx = mDownCanvasX + "px";
		const stry = mDownCanvasY + "px";
		circle.style.left = strx;
		circle.style.top =  stry;

		line.style.left = strx;
		line.style.top =  stry;

		arrowEnd.style.setProperty("--origin", "0px 0px" /*strx + " " + stry*/)

		circle.hidden = false;
	}
	canvas.onmousemove = (ev) => {

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

		const x1 = mDownCanvasX;
		const y1 = mDownCanvasY;
		const [x2, y2] = getCoords(ev);
		const dx = x2 - x1;
		const dy = y2 - y1;
		const d = Math.sqrt(dx*dx + dy*dy);

		const a = Math.atan2(dy,dx);

		line.style.width = d + "px";
		line.style.setProperty("--rot", a + "rad")

		arrowEnd.style.setProperty("--rot", a + "rad")
		arrowEnd.style.left = x2 + "px";
		arrowEnd.style.top = y2 + "px";

		arrowEnd.hidden = false;
		line.hidden = false;
	}
	canvas.onmouseup = (ev)=> {
		
		if (!placePartOnClic) { return; }
		mouseIsDown = false;
		circle.hidden = true;
		arrowEnd.hidden = true;
		line.hidden = true;
		canvas.style.cursor = "crosshair";

		const x1 = mDownCanvasX;
		const y1 = mDownCanvasY;
		const [x2, y2] = getCoords(ev);
		const dx = x2 - x1;
		const dy = y2 - y1;

		arrowEnd.style.left = x2 + "px";
		arrowEnd.style.top = y2 + "px";

		circle.hidden = true;
		arrowEnd.hidden = true;
		panels.style.pointerEvents = "auto";

		/*
		const i = partiControls.selector.selectedIndex
		const elem =  elementaries[i];

		const n = ++elem.cantidad * 4;
		const newPos = new Float32Array(n);
		const newVel = new Float32Array(n);

		newPos.set(elem.posiciones);
		newPos.set([ x1-canvas.width/2, -(y1-canvas.height/2), 0, 1], n-4);

		newVel.set(elem.velocidades);
		newVel.set([dx/50, -dy/50, 0, 1], n-4);

		elem.posiciones = newPos;
		elem.velocidades = newVel;
		partiControls.cantInput.placeholder = elem.cantidad;

		if (!particulasQueActualizar[i]) {
			particulasQueActualizar[i] = 1;
		} else {
			particulasQueActualizar[i]++;
		}
		

		console.log(particulasQueActualizar)
		updatingParameters = true;

		console.log(elementaries);
		*/
	}

	// Botones de tiempo
	pauseButton.onclick =_=> pausar();
	stepButton.onclick =_=> stepear();
	resetButton.onclick =_=> resetear();

	// Controles
	document.addEventListener("keydown", function(event) {
		const isTextInput = event.target.tagName === 'INPUT' && event.target.type === 'text';
		if (isTextInput) return;
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
				switchVisibility(infoPanel);
				break;
			case "KeyH":
				switchVisibility(panels);
				break;
			case "KeyD":
				switchVisibility(debugInfo);
				break;
		}
	});

	// Botón de info debug
	infoButton.onclick =_=> switchVisibility(infoPanel);

	// Botón de export e import
	exportButton.onclick =(event)=> exportarSetup(elementaries, rules, seedInput.value, "Cells GPU setup", !!event.ctrlKey);

	importButton.onclick =_=> {
		importarJson()
		.then((setup) => {
			cargarSetup(setup);
			resetear();
		})
		.catch((error) => {
			window.alert("Error al importar, archivo descartado.\n" + error);
			console.error(error);
		});
	}

	// Sonidos
	volumeRange.onchange =_=> {
		clickSound.volume = `${volumeRange.value * !muted}`;
		playSound(clickSound);
	}
	panels.addEventListener("click", function(event) {
		if (event.target.tagName === "BUTTON") { // (event.target.classList.contains('my-button-class'))
			playSound(clickSound);
		}
	});

	// Opciones del ambiente/simulación
	ambientControls.bounceInput.oninput =_=> setAutomaticInputElementWidth(ambientControls.bounceInput, 3, 12, 0);
	ambientControls.updateButton.onclick =_=> aplicarAmbiente();

	// Creador de elementaries
	partiControls.submitButton.onclick =()=> {

		let returnFlag = false,
		name = partiControls.nameInput,
		radius, cant;

		// Usar placeholders si vacíos. Si no lo están: validar.
		if (name.value) { name = name.value; } 
		else if (name.placeholder) { name = name.placeholder; }
		else { titilarBorde(name); returnFlag = true; }

		[cant, returnFlag] = checkAndGetNumberInput(partiControls.cantInput, returnFlag);
		[radius, returnFlag] = checkAndGetNumberInput(partiControls.radiusInput, returnFlag);
		
		if (returnFlag) { return; }

		// Una vez validado todo:
		/*let [pos, vel] = [[], []];

		if (preloadPositions) {[pos, vel] = crearPosiVel(cant, radius * 2, false);}  CODE 0 */ 

		const [pos, vel] = crearPosiVel(cant, radius * 2, false);

		cargarElementary( crearElementary(
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
	}
	partiControls.placeButton.onclick =_=> {
		placePartOnClic = !placePartOnClic;
		switchClass(partiControls.placeButton);
		if (placePartOnClic) { canvas.style.cursor = "crosshair"; }
		else { canvas.style.cursor = "default"; }
	}

	// Creador de reglas de interacción
	ruleControls.submitButton.onclick =(event)=> {

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

		const newRule = crearRule(
			newRuleName,
			ruleControls.targetSelector.value,
			ruleControls.sourceSelector.value,
			intens,
			qm,
			dmin,
			dmax,
		);

		cargarRule(newRule)

		setPlaceholdersRules();
		removeRuleControlsValues();
		borraRuleButton.hidden = false;
	}
	ruleControls.updateButton.onclick =_=> updatingParameters = true;
	ruleControls.targetSelector.onchange =_=> setPlaceholderRuleName();
	ruleControls.sourceSelector.onchange =_=> setPlaceholderRuleName();

	// Rule manager
	borraRuleButton.onclick =(event)=> {
		const indexToDelete = ruleControls.selector.selectedIndex;
		if (indexToDelete === -1) {
			console.log("Esto no debería haber pasado...")
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
		setPlaceholdersRules();
	}
	ruleControls.selector.onchange =_=> setPlaceholdersRules();

	// Particle manager
	borraParticleButton.onclick =(event)=> {
		const indexToDelete = partiControls.selector.selectedIndex;
		if (indexToDelete === -1) {
			console.log("Esto no debería haber pasado...")
			titilarBorde(partiControls.selector)
			return;
		}

		if (event.ctrlKey) {
			elementaries = [];
			partiControls.selector.innerHTML = "";
			ruleControls.targetSelector.innerHTML = "";
			ruleControls.sourceSelector.innerHTML = "";
			borraParticleButton.hidden = true;
			partiControls.placeButton.hidden = true;
		} else {
			elementaries.splice(indexToDelete, 1);
			partiControls.selector.options[indexToDelete].remove();
			ruleControls.targetSelector.options[indexToDelete].remove();
			ruleControls.sourceSelector.options[indexToDelete].remove();
			if (!partiControls.selector.options.length) {
				borraParticleButton.hidden = true;
				partiControls.placeButton.hidden = true;
			}
		}
		setPlaceholdersParticles();
	}
	partiControls.selector.onchange =_=> setPlaceholdersParticles();

//

// INICIALIZACIÓN

	// Novedades
	if (LAST_VISITED_VERSION !== CURRENT_VERSION) {

		newsText.innerText = CHANGELOG;
		newsDialog.open = true;

		dialogOk2Button.onclick =_=> {
			localStorage.setItem("STORED_VERSION_NUMBER", "_" + CURRENT_VERSION);
			newsDialog.open = false;
		}
		dialogNVM2Button.onclick =_=> {
			localStorage.setItem("STORED_VERSION_NUMBER", CURRENT_VERSION); //CURRENT_VERSION
			newsDialog.open = false;
		}
	}
	// Diálogo de ayuda
	if ((NEW_USER === "1"|| NEW_USER === null)) {
	
		helpDialog.open = true;
		
		dialogOkButton.onclick =_=> {
			localStorage.setItem("NEW_USER", 1);
			helpDialog.open = false;
		}
		dialogNVMButton.onclick =_=> {
			localStorage.setItem("NEW_USER", 0);
			helpDialog.open = false;
		}
	}
	// Tamaño canvas y sonido
	canvasInfo.innerText = `${canvas.width} x ${canvas.height} (${(canvas.width/canvas.height).toFixed(6)})`;
	clickSound.volume = volumeRange.value;
	// Valores por defecto
	//ambientControls.frictionInput.value = parseFloat(ambient.friction.toFixed(4));
	ambientControls.frictionInput.placeholder = ambient.friction.toFixed(3);
	//ambientControls.bounceInput.value = parseInt(ambient.bounce);
	ambientControls.bounceInput.placeholder = ambient.bounce;
	//ambientControls.velInput.value = parseFloat(ambient.maxInitVel);
	ambientControls.velInput.placeholder = ambient.maxInitVel;

	// Inicializar seed o importar
	if (START_WITH_SETUP) {
		generarSetupClásico(10, "", true, debug); //"0.6452130" x10
	} else {
		setRNG(seedInput.value);
	}
	// Interfaz
	if (SHOW_DEBUG) {switchVisibility(debugInfo); switchVisibility(infoPanel); }

//

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
//

// Buffers y pipelines

	const renderPassDescriptor = {	//Parámetros para el render pass que se ejecutará cada frame
		colorAttachments: [{		// es un array, de momento sólo hay uno, su @location en el fragment shader es entonces 0
			view: context.getCurrentTexture().createView(),
			loadOp: "clear",
			clearValue: uiSettings.bgColor,
			storeOp: "store",
		}]
	};

	let simulationPipeline;
	let simulationPipeline2;
	let particleRenderPipeline;
	let bindGroups = [];

	let positionBuffers = [];	// tienen que estar afuera de editBuffers porque no siempre los necesita cambiar
	let velocitiesBuffer;

	const params2Buffer = device.createBuffer({ // está afuera porque no necesita cambiar nunca. Sólo se le escribe con nros random.
		label: "Random Numbers from CPU & frame number",
		size: 16, //828.5 días de simulación hasta overflow u32. Podría poner el frame number. Usando arraybuffer
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	})

	// Parámetros de longitud fija (por lo tanto buffers de size fijo)
	const paramsBufferSize = 8 + 4 + 4 + 4 + 4 + 4 + 8; // [canvasDims], N, Ne, Nr, Nd, Np, [frictionInv, bounceF] 

	const paramsArrBuffer = new ArrayBuffer(paramsBufferSize);

	const canvasDimsArr = new Float32Array(paramsArrBuffer, 0, 2); // offset en bytes, longitud en cant de elementos

	const NArr = new Uint32Array(paramsArrBuffer, 8, 1);	// N
	const NeArr = new Uint32Array(paramsArrBuffer, 12, 1);	// Ne
	const NrArr = new Uint32Array(paramsArrBuffer, 16, 1);	// Nr
	const NdArr = new Uint32Array(paramsArrBuffer, 20, 1);	// Nd
	const LpArr = new Uint32Array(paramsArrBuffer, 24, 1);	// Np

	const ambientArr = new Float32Array(paramsArrBuffer, 28, 2)
	
	const paramsBuffer = device.createBuffer({
		label: "Params buffer",
		size: paramsBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	writeAmbientToBuffer();

	let distanciasBuffer;
	let datosInteraccionesBuffer;

//

function editBuffers() {

	// Cantidades y parámetros varios

	const Ne = elementaries.length;

	const datosElemsSize = (3 * 4 + 4 + 16) * Ne; // 3 cants, radio, color
	const datosElementariesArrBuffer = new ArrayBuffer(datosElemsSize);

	N = 0;
	for (let i = 0; i < Ne; i++) { 

		const nLocal = elementaries[i].cantidad;
		N += nLocal; // N también hace de acumulador para este for.

		const cants = new Uint32Array(datosElementariesArrBuffer, i * 8*4, 3);
		const radioColor = new Float32Array(datosElementariesArrBuffer, (i * 8*4) + 3*4, 5);

		cants.set([nLocal, N, N-nLocal]);	// [cants, cantsacum, cantsAcum2]
		radioColor.set([elementaries[i].radio]);
		radioColor.set(elementaries[i].color,1);

	}

	const datosElementariesBuffer = device.createBuffer({
		label: "Buffer: datos elementaries",
		size: datosElemsSize,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	})
	device.queue.writeBuffer(datosElementariesBuffer, 0, datosElementariesArrBuffer, 0, datosElemsSize);

	// Distancias

	const reglasActivas = [];
	const m = new Uint8Array(Ne**2);
	
	for (let rule of rules) {
		const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.targetName});
		const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.sourceName});

		if (targetIndex === -1 || sourceIndex ===-1) { continue; }
		reglasActivas.push(rule);

		const [f, c] = [targetIndex, sourceIndex].sort();

		const index = (f * Ne) + c;
		m[index]++;
	}
	const Nr = reglasActivas.length;
	
	let Nd = 0;
	let Np = 0;
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
		Np = datosInteracciones.length;
	}

	distanciasBuffer = device.createBuffer({
		label: "Distancias buffer",
		size: Nd * 4 || 4,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
	});

	const datosInteraccionesArray = new Uint32Array(datosInteracciones.flat());
	datosInteraccionesBuffer = device.createBuffer({
		label: "datos interacciones buffer",
		size: Nd * 4 * 4 || 4,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(datosInteraccionesBuffer, 0, datosInteraccionesArray);
	
	// Reglas

	const rulesArray = new Float32Array(Nr * 8);

	for (let i = 0; i < Nr; i++) { // llenar el array de reglas
		rulesArray.set([
			reglasActivas[i].targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == reglasActivas[i].targetName}),
			reglasActivas[i].sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == reglasActivas[i].sourceName}),
			reglasActivas[i].intensity,
			reglasActivas[i].quantumForce,
			reglasActivas[i].minDist,
			reglasActivas[i].maxDist,
			0.0,//padding
			0.0,
		], 8*i)
	}

	const reglasBuffer = device.createBuffer({
		label: "Reglas",
		size: rulesArray.byteLength || 32,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(reglasBuffer, 0, rulesArray)

	// Posiciones y velocidades

	const positionsArray = new Float32Array(N*4);
	const velocitiesArray = new Float32Array(N*4);

	let offset = 0;

	for (let elem of elementaries) {
		const L = elem.cantidad * 4;
		const posiVelsIncompleto = (elem.posiciones.length !== L || elem.velocidades.length !== L);
		if (posiVelsIncompleto) {
			resetPosiVels = true;
			break;
		}
	}

	if (resetPosiVels || cargarPosiVelsAlBuffer) {


		for (let elementary of elementaries) {
			let pos, vel;
			if (cargarPosiVelsAlBuffer) {
				pos = elementary.posiciones;
				vel = elementary.velocidades;
				cargarPosiVelsAlBuffer = false;
			} else {
				[pos, vel] = crearPosiVel(elementary.cantidad, elementary.radio * 2);
			}

			positionsArray.set(pos, offset);
			velocitiesArray.set(vel, offset);
			elementary.posiciones = pos;
			elementary.velocidades = vel;
			offset += elementary.cantidad*4;
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
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
		});
		device.queue.writeBuffer(velocitiesBuffer, 0, velocitiesArray);

		resetPosiVels = false;

	} else {
		for (let i = 0; i < Ne; i++) { // llenar los arrays de posiciones y velocidades ya presentes en elementaries
			/*
			// write al buffer las particulas que hay que actualizar
			if (particulasQueActualizar[i]) {

				const L = particulasQueActualizar[i] * 4

				const newPos = elementaries[i].posiciones.slice(-L);
				const newVel = elementaries[i].velocidades.slice(-L);


			}*/

			//const L = elementaries[i].cantidad * 4;
			//positionsArray.set(elementaries[i].posiciones, offset);
			//velocitiesArray.set(elementaries[i].velocidades, offset);
			//offset += L;

		}
	}





	// Parámetros de longitud fija

	canvasDimsArr.set([canvas.width, canvas.height]);
	NArr.set([N]);
	NeArr.set([Ne]);
	NrArr.set([Nr]);
	NdArr.set([Nd]);
	LpArr.set([Np]);

	device.queue.writeBuffer(paramsBuffer, 0, paramsArrBuffer, 0, 28); 
	/* buffer, buferOffset (B), data, dataOffset (B*), size (B*) 
	* = B porque data no es typedArray. De lo contrario sería en cant. de elementos. */

	editingBuffers = false;
	return [
		{
			positionBuffers,
			velocitiesBuffer,
			paramsBuffer,
			datosElementariesBuffer,
			distanciasBuffer,
			reglasBuffer,
			datosInteraccionesBuffer,
		},
		Nd,
		Ne,
		Np, // Np, cantidad de pares distintos de interacción
		Nr || 1,
	]
}

function updateSimulationParameters() {

	console.log("Updating simulation parameters...");
	setRNG(seedInput.value);

	// CREACIÓN DE BUFFERS
	const [GPUBuffers, Nd, Ne, Np, Nr] = editBuffers(); // diccionario con todos los buffers y datos para shader

	if (N === 0) { updatingParameters = false; return;}

	// CARGAR SHADERS

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader(Ne),
	});
	
	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader(WORKGROUP_SIZE, Np),
	})

	if (PRECALCULAR_DISTANCIAS) {
		const distancesShaderModule = device.createShaderModule({
			label: "Distances compute shader",
			code: computeDistancesShader(WORKGROUP_SIZE, Nd),
		})
	}

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
		}, {
			binding: 6, // random numbers
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
					resource: { buffer: GPUBuffers.paramsBuffer, } 
				}, {
					binding: 1,
					resource: { buffer: GPUBuffers.velocitiesBuffer }
				}, {
					binding: 2,
					resource: { buffer: GPUBuffers.reglasBuffer }
				}, {
					binding: 3,
					resource: { buffer: GPUBuffers.distanciasBuffer }
				}, {
					binding: 4, // Datos elementaries (cantidades, radio, color)
					resource: { buffer: GPUBuffers.datosElementariesBuffer, 
						//offset: 0, // min: 256
						//size: Ne * 4
					}
				}, {
					binding: 5,
					resource: { buffer: GPUBuffers.datosInteraccionesBuffer }
				}, {
					binding: 6, // random numbers
					resource: { buffer: params2Buffer }
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

	// PIPELINE SETUP

	const pipelineLayout = device.createPipelineLayout({
		label: "Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto],
	}); // El orden de los bind group layouts tiene que coincider con los atributos @group en el shader

	/*const pipelineLayout2 = device.createPipelineLayout({
		label: "Pipeline Layout 2",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto, bindGroupLayoutDist ],
	});*/

	// Crear render pipeline (para usar vertex y fragment shaders)
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

	// Crear compute pipelines
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

	if (PRECALCULAR_DISTANCIAS) {
		simulationPipeline2 = device.createComputePipeline({
			label: "Distances pipeline",
			layout: pipelineLayout,
			compute: {
				module: distancesShaderModule,
				entryPoint: "computeMain",
			},
		});
	}

	workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	workgroupCount2 = Math.ceil(Nd / WORKGROUP_SIZE);
	//console.log( `N / workgroup size: ${N} / ${WORKGROUP_SIZE} = ${N/WORKGROUP_SIZE}\nworkgroup count: ${workgroupCount}`);
	updatingParameters = false;
}

// ANIMATION LOOP

async function newFrame(){

	if (paused && !stepping) { return; }

	if ( updatingParameters ){	// Rearmar buffers y pipeline
		frame = 0;
		updateSimulationParameters();
		console.log("updated!");
	}

	if (editingBuffers) { editBuffers(); } // permite editar los buffers sin tener que recrear la pipeline.

	if (editingAmbient) {
		writeAmbientToBuffer();
		editingAmbient = false;
		console.log("Updated ambient parameters.");
	}

	const encoder = device.createCommandEncoder();

	timestamp(0, encoder); // Initial timestamp - before compute pass

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

		timestamp(1, encoder);

		device.queue.writeBuffer(
			params2Buffer,
			0,
			new Float32Array([
				rng() * 100,
				rng() * 100, // seed.xy
				1 + rng(),
				1 + rng(), // seed.zw
			])
		);
		
		// Calcular simulación (actualizar posiciones y velocidades)
		const computePass = encoder.beginComputePass();
		computePass.setPipeline(simulationPipeline);
		computePass.setBindGroup(0, bindGroups[frame % 2]); // posiciones alternantes
		computePass.setBindGroup(1, bindGroups[2]); // lo demás
		/* El compute shader se ejecutará N veces. El workgroup size es 64, entonces despacho ceil(N/64) workgroups, todos en el eje x. */
		computePass.dispatchWorkgroups(workgroupCount, 1, 1); // Este vec3<u32> tiene su propio @builtin en el compute shader.
		computePass.end();

	} else {timestamp(1, encoder);}

	timestamp(2, encoder); // Post compute passes

	// Iniciar un render pass (que usará los resultados del compute pass)
	
	renderPassDescriptor.colorAttachments[0].clearValue = uiSettings.bgColor; // Actualizar color de fondo.
	renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
	const pass = encoder.beginRenderPass(renderPassDescriptor);

	if (N) {
		pass.setPipeline(particleRenderPipeline);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.setBindGroup(0, bindGroups[((frame + 1) % 2)]);
		pass.setBindGroup(1, bindGroups[2]);
		pass.draw(vertices.length /2, N);	// 6 vertices. renderizados N veces
	}

	pass.end(); // finaliza el render pass
	
	timestamp(3, encoder);


	device.queue.submit([encoder.finish()]);

	if ( false && (frame % 60 === 30)) {

		const values = new Float32Array(await readBuffer(device, velocitiesBuffer ));
		
		const values2 = [];
		for (let i=2; i<values.length; i += 4) { values2.push(values[i]); }
		//generateHistogram2(values2, 0.6, 10);
		
		console.log(values2)
		//console.log(values[2])
	}
	
	if (frame % 30 === 0) {	// Leer el storage buffer y mostrarlo en debug info (debe estar después de encoder.finish())
		let dif1, dif2, dif3, text = "";
		if (timer) {
			const arrayBuffer = await readBuffer(device, queryBuffer);
			const timingsNanoseconds = new BigInt64Array(arrayBuffer);
			dif1 = (Number(timingsNanoseconds[1]-timingsNanoseconds[0])/1_000_000)//.toFixed(6);
			dif2 = (Number(timingsNanoseconds[2]-timingsNanoseconds[1])/1_000_000)//.toFixed(6);
			dif3 = (Number(timingsNanoseconds[3]-timingsNanoseconds[2])/1_000_000)//.toFixed(6);
		} else {
			dif1 = (t[1] - t[0]);
			dif2 = (t[2] - t[1]);
			dif3 = (t[3] - t[2]);
			text +="⚠ GPU Timing desact.\n"
		}
		text += `Compute 1: ${dif1.toFixed(4)} ms\nCompute 2: ${dif2.toFixed(4)} ms\nCompute T: ${(dif1+dif2).toFixed(4)} ms`;
		text += `\nDraw: ${dif3.toFixed(4)} ms`;
		if (dif1 + dif2 + dif3 > 30) {
			text = text + "\nGPU: Brrrrrrrrrrr";
		}
		displayTiming.innerText = text;
	}

	ageInfo.innerText = frame;
	frame++; frameCounter++;

	const timeNow = performance.now();
	if (timeNow - refTime >= 1000) {
		fps = frameCounter;
		frameCounter = 0;
		refTime = timeNow;
		fpsInfo.innerText = fps;
	}

	if ( !stepping ){	// Iniciar nuevo frame
		animationId = requestAnimationFrame(newFrame);
	}
}

//TODO:
/* Pasar los parámetros pertinentes mediante writebuffer en lugar de recrear nuevos buffers */
/* Agregar partículas con click */
/* Functiones para quitar o agregar partículas. permite mergers/eaters */
/* Revisar que PP no se haya roto */
/* Antialiasing / renderizar a mayor resolución */
