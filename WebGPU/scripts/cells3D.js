import { inicializarCells, autoCanvasDims } from "inicializar-webgpu";
import { renderShader3D, wallShader3D, computeShader3D } from "shaders";
import { Mat4, Vec3, Elementary, Rule, Setup} from "classes";
import { boxMesh, hexString_to_rgba, printCMMatrix, switchClass,
	setAutomaticInputElementWidth, labelError, importarJson,
	playSound } from "utilities";

// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf

const 
SHOW_TITLE = false,

[device, canvas, canvasFormat, context, gpuTiming] = await inicializarCells(SHOW_TITLE),

SETUPS_FOLDER = "../../data/",
WORKGROUP_SIZE = 64,
NEW_USER = localStorage.getItem("NEW_USER"),
CURRENT_VERSION = document.getElementById("title").innerText,
LAST_VISITED_VERSION = localStorage.getItem("STORED_VERSION_NUMBER"),
CHANGELOG = `\
	${CURRENT_VERSION}

	* En desarrollo, pero casi todo lo fundamental ya está hecho :D
	* Así va a quedar de momento.
	* Aviso: cambiaron varios controles.

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
	editLims: true,

	justLoadedSetup: false,

	runningCameraLoop: false,

	renderScenario: true,
	indexedScenario: true,
},
eyePosition = new Vec3([0, 0, 1000]),  //camera position in world space
eyeDirection = new Vec3([0, 0, -1]), //camera direction in world space
up = new Vec3([0, 1, 0]),
right = new Vec3(),
forward = new Vec3(),
rotAxis = new Vec3([0, 1, 0]),
ph = new Vec3(), //placeholder
rotateSpeed = 2*Math.PI/180,
keysPressed = new Set(),
camControls = {
	left: "KeyA",
	right: "KeyD",
	forward: "KeyW",
	backward: "KeyS",
	up: "KeyZ",
	down: "KeyX",
	rotLeft: "KeyJ",
	rotRight: "KeyL",
	slow: "ShiftLeft",
	reset: "KeyC",
	test: "KeyK",
},
sceneSettings = {
	fov: 1.0,
	fovDefault: 1.0,
	baseCamSpeed: 20,
	baseCamSpeedDefault: 20,
	lims: new Float32Array([500, 300, 500]),
},
nearClip = 0.1,
farClip = 5000;

let 
N = 0, 	// Cantidad total de partículas
elementaries = [],	// Array de familias de partículas (clase Elementary)
rules = [],			// Array de reglas de interacción (clase Rule)
workgroupCount,		// workgroups para ejecutar las reglas de interacción (mover las partículas)
rng,
frame = 0,
animationId,
paused = true,
stepping = false,
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
textureView,
depthTextureView,
projectionMatrix = new Mat4(),
viewProjectionMatrix = new Mat4(),
rotYCurrent = 0;

// TIMING & DEBUG 
	const STARTING_SETUP_NUMBER = 1,
	SETUP_FILENAME = "Cells GPU setup - Test Varios", // case 2
	SHOW_DEBUG = false;
	//localStorage.setItem("NEW_USER", 1);
	//localStorage.setItem("STORED_VERSION_NUMBER", -1);
	const capacity = 3; //Max number of timestamps 
	const t = new Float32Array(capacity);
	let querySet, queryBuffer;

	if (gpuTiming) { // véase https://omar-shehata.medium.com/how-to-use-webgpu-timestamp-query-9bf81fb5344a
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
	function randomPosition(elementaryIndex, margin = 0) {
		return ([
			(rng() - 0.5) * (sceneSettings.lims[0]*2 - margin), // TODO: así como está es eficiente pero el margen no es el esperado
			(rng() - 0.5) * (sceneSettings.lims[1]*2 - margin),
			(rng() - 0.5) * (sceneSettings.lims[2]*2 - margin),
			elementaryIndex
		]);
	}
	function randomVelocity() {
		return ([
			(2 * rng() - 1) * ambient.maxInitVel,
			(2 * rng() - 1) * ambient.maxInitVel,
			(2 * rng() - 1) * ambient.maxInitVel,
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

	// Utilities for some HTML elements

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
	function switchVisibilityAttribute(element) {
		element.hidden ^= true;
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
	function enableIfChanged(button, marker, inputs) {  // shows the button as enabled if any element of inputs is not empty
		let allFieldsEmpty = true;
		for (const input in inputs) {
			if (inputs[input].value) {
				allFieldsEmpty = false;
				break;
			}
		}
		switchClass(button, "disabled", allFieldsEmpty);
		marker.hidden = allFieldsEmpty;
	}

	// Handling of classes

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

		// Load scene
		if (setup.scene) {

			if (setup.scene.fov) sceneSettings.fov = setup.scene.fov;
			
			if (setup.scene.lims) {
				sceneSettings.lims.set(setup.scene.lims);
				setPlaceholdersLims();
				flags.editLims = true;
			}

		}

		flags.justLoadedSetup = true;
		resetear(draw);
		setPlaceholdersParticles(true);
		setPlaceholdersRules(true);
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
	function setPlaceholdersParticles(delIfEmpty=false) {
		const i = partiControls.selector.selectedIndex;
		if (i === -1) {
			if (delIfEmpty) {
				partiControls.nameInput.placeholder = "";
				partiControls.colorInput.value = "#000000";
				partiControls.cantInput.placeholder = "";
				partiControls.radiusInput.placeholder = "";
				currentCant.innerText = "";
			}
			return;
		}
		partiControls.nameInput.placeholder = elementaries[i].nombre ?? "";
		partiControls.colorInput.value = elementaries[i].colorAsHex;//rgba_to_hexString(elementaries[i].color);
		partiControls.cantInput.placeholder = elementaries[i].cantidadOriginal;
		partiControls.radiusInput.placeholder = elementaries[i].radio;
		currentCant.innerText = elementaries[i].cantidad;
	}
	function setPlaceholdersRules(delIfEmpty=false) {
		const i = ruleControls.selector.selectedIndex;
		if (i === -1) {
			if (delIfEmpty) {
				ruleControls.nameInput.placeholder = "";
				ruleControls.targetSelector.selectedIndex = "";
				ruleControls.sourceSelector.selectedIndex = "";
				ruleControls.intens.placeholder = "";
				ruleControls.qm.placeholder = "";
				ruleControls.dmin.placeholder = "";
				ruleControls.dmax.placeholder = "";
			}
			return;
		}
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
	function setPlaceholdersLims() {
		sceneControls.inputs.lims.x.placeholder = sceneSettings.lims[0];
		sceneControls.inputs.lims.y.placeholder = sceneSettings.lims[1];
		sceneControls.inputs.lims.z.placeholder = sceneSettings.lims[2];
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
		//if (CPOptions.hidden){ panelTitle.style = "line-height: 3ch;"; } else { panelTitle.style = ""; }
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
	function getMouseDeltas(event) {
		const [x1, y1] = [mDownX, mDownY];
		const [x2, y2] = [event.offsetX, event.offsetY];
		return [x2 - x1, y2 - y1];
	}
	function updatePosInfoPanel() {
		posInfo.innerText = `Pos: (${eyePosition.toString(0)})
		Aim: (${eyeDirection.toString(2)})
		Y Rot: ${(rotYCurrent*180/Math.PI).toFixed(1)}°`
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
		if (gpuTiming) {
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
	async function displayTimestampResults() {
		const dt = new Float64Array(capacity-1);
		let text = "";
		if (gpuTiming) {
			// Leer el storage buffer y mostrarlo en debug info (debe estar después de encoder.finish())
			const arrayBuffer = await readBuffer(device, queryBuffer);
			const timingsNanoseconds = new BigInt64Array(arrayBuffer);
			for (let i = 0; i < dt.length; i++) {
				dt[i] = Number(timingsNanoseconds[i+1]-timingsNanoseconds[i]) / 1_000_000;
			}

		} else {
			for (let i = 0; i < capacity; i++) {
				dt[i] = (t[i+1] - t[i]);
			}
			text +="⚠ GPU Timing desact.\n";
		}
		text += `Draw: ${dt[0].toFixed(3)} ms\
				\nCompute: ${dt[1].toFixed(3)} ms`;
		
		if (dt.reduce((a, v) => a + v, 0) > 30) {
			text += "\nGPU: Brrrrrrrrrrr";
		}
		displayTiming.innerText = text;
	}
	async function readPrintResetAtomic(device, buffer, reset = true) {
		const resultAtomic = new Uint32Array(await readBuffer(device, buffer));
		console.log(resultAtomic[0]);
		if (reset) {
			resultAtomic[0] = 0;
			device.queue.writeBuffer(GPUBuffers.atomicStorage, 0, resultAtomic);
		}
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
	function getDepthTextureView(dims) {
		return device.createTexture({
			size: dims,
			format: 'depth24plus',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		}).createView();
	}
	async function debuggingRead(device, buffer) {

		const cond = frame % 60 === 30;

		if (cond) {

			//const values = new Float32Array(await readBuffer(device, GPUBuffers.positionBuffers[0]));
			const values = new Float32Array(await readBuffer(device, buffer));
	
			const values2 = [];
			//for (let i=2; i<values.length; i += 4) { values2.push(values[i]); } // read the w component of velocities
			//generateHistogram2(values2, 0.6, 10);
	
			//const pos = values.slice(3801*4, 3801*4+4);

			//console.log(values2[0]);
			//console.log(values[2]);
	
			const wOfVels = values.filter((element, index) => element !== 0 && (index + 1) % 4 === 0).length;
			console.log(wOfVels);
		}
	}

	// Prepare to edit buffers (or do so if immediately possible)
	function applyCanvas() {
		[canvas.width, canvas.height] = ambient.canvasDims;
		canvasInfo.innerText = `${canvas.width} x ${canvas.height} (${(canvas.width/canvas.height).toFixed(6)})`;
		textureView = getTextureView(ambient.canvasDims);
		depthTextureView = getDepthTextureView(ambient.canvasDims);
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
			writePStyleToBuffer();
			console.log("Updated buffer: PStyle");
			renderIfPaused();
		} else {
			flags.editPStyle = true;
			flags.updateSimParams = true;
		}
	}
	async function applyLims() {

		// validate inputs
		let invalidInput = false, xlim, ylim, zlim;
		
		[xlim, invalidInput] = checkAndGetNumberInput(sceneControls.inputs.lims.x, invalidInput, true);
		[ylim, invalidInput] = checkAndGetNumberInput(sceneControls.inputs.lims.y, invalidInput, true);
		[zlim, invalidInput] = checkAndGetNumberInput(sceneControls.inputs.lims.z, invalidInput, true);

		if (!invalidInput) {

			// set internal variables
			sceneSettings.lims.set([xlim, ylim, zlim])

			// set posivels, cantidades de cada elementary, y N

			const posArray = new Float32Array(await readBuffer(device, GPUBuffers.positionBuffers[frame%2]));
			const velArray = new Float32Array(await readBuffer(device, GPUBuffers.velocities));

			let k = 0; // current last empty index in new array
			let ke = new Uint32Array(elementaries.length);
			let r = 0.0;
			let elemIndex = 0;
			for (let i = 0; i < posArray.length; i += 4) {
				
				elemIndex = posArray[i+3];
				r = elementaries[elemIndex].radio;

				if (
					Math.abs(posArray[i    ]) + r> sceneSettings.lims[0] ||
					Math.abs(posArray[i + 1]) + r> sceneSettings.lims[1] || 
					Math.abs(posArray[i + 2]) + r> sceneSettings.lims[2] 
					) { continue; } 
				else {

					/* No funciona, no sé por qué
						posArray.copyWithin(k, i, i + 4 );
						velArray.copyWithin(k, i, i + 4 );

						elementaries[elemIndex].posiciones.set(posArray.slice(k,k+4),ke[elemIndex]);
						elementaries[elemIndex].velocidades.set(velArray.slice(k,k+4),ke[elemIndex]);
					*/
					elementaries[elemIndex].posiciones.set(posArray.slice(i, i + 4), ke[elemIndex]);
					elementaries[elemIndex].velocidades.set(velArray.slice(i, i + 4), ke[elemIndex]);
	
					ke[elemIndex] += 4;
					k += 4;
				}
			}
	
			// Crop outdated values at the end of the arrays
			for (let i = 0; i < elementaries.length; i++) {
				elementaries[i].cantidad = ke[i] / 4;
				elementaries[i].posiciones = elementaries[i].posiciones.slice(0,ke[i]);
				elementaries[i].velocidades = elementaries[i].velocidades.slice(0,ke[i]);
				// this doesn't work for some reason:
				//elementaries[i].velocidades = new Float32Array(elementaries[i].velocidades.buffer, 0, ke[i]);
			}
			N = k / 4;

			// set placeholders
			sceneControls.inputs.lims.x.placeholder = xlim;
			sceneControls.inputs.lims.y.placeholder = ylim;
			sceneControls.inputs.lims.z.placeholder = zlim;
			currentCant.innerText = elementaries[partiControls.selector.selectedIndex]?.cantidad ?? "";

			// clear inputs
			sceneControls.inputs.lims.x.value = "";
			sceneControls.inputs.lims.y.value = "";
			sceneControls.inputs.lims.z.value = "";

			// disable button and clear marker
			switchClass(sceneControls.applyButton, "disabled", true);
			markers[4].hidden = true;
			
			// call to update buffers
			flags.editLims = true;
			flags.updateSimParams = true;
			if (paused) stepear();
		}
	}

	// Functions to edit buffers (usually used by editBuffers())
	function writeCanvasToBuffer() {
		paramsArrays.canvasDims.set(ambient.canvasDims);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.canvasDims.byteOffset, paramsArrays.canvasDims);
		flags.updateCanvas = false;
	}
	function writeAmbientToBuffer() {
		paramsArrays.ambient.set([1 - ambient.friction, ambient.bounce / 100]);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.ambient.byteOffset, paramsArrays.ambient);
		flags.editAmbient = false;
	}
	function updateDatosElementariesBuffer() {

		const Ne = elementaries.length;

		const bytesPerElementary = 16 + 4 + 4 + 8; // color, radio, cantidad (de partículas en elementary), padding
		const datosElemsSize = bytesPerElementary * Ne;

		const datosElementariesArrBuffer = new ArrayBuffer(datosElemsSize);
		N = 0;
		for (let i = 0; i < Ne; i++) {  // N, radios, colores, cantidades

			let cant;
			if (flags.resetParts) {
				cant = elementaries[i].cantidadOriginal;
				elementaries [i].cantidad = cant;
			}
			else {cant = elementaries[i].cantidad };
	
			N += cant;

			const colorRadio = new Float32Array(datosElementariesArrBuffer, i * bytesPerElementary, 5);
			colorRadio.set([...elementaries[i].color, elementaries[i].radio]);

			const cants = new Uint32Array(datosElementariesArrBuffer, i * bytesPerElementary + 5*4, 1);
			cants.set([cant]);
		}
		
		currentCant.innerText = elementaries[partiControls.selector.selectedIndex]?.cantidad ?? "";

		paramsArrays.N.set([N]);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.N.byteOffset, paramsArrays.N);
	
		GPUBuffers.datosElementaries = device.createBuffer({
			label: "Buffer: datos elementaries",
			size: datosElemsSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		})
		device.queue.writeBuffer(GPUBuffers.datosElementaries, 0, datosElementariesArrBuffer);
	}
	function updateParticlesBuffers() {

		const Ne = elementaries.length;
	
		paramsArrays.Ne.set([Ne]);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.Ne.byteOffset, paramsArrays.Ne);
		
		updateDatosElementariesBuffer();
		
		if (flags.justLoadedSetup) { flags.resetParts = false; }
	
		if (!flags.resetParts) {
			for (let elem of elementaries) {
				const L = elem.cantidad * 4;
				const posiVelsIncompleto = (elem.posiciones.length !== L || elem.velocidades.length !== L);
				if (posiVelsIncompleto) {
					flags.resetParts = true;
					console.warn("Detectadas partículas faltantes, reseteando posiciones y velocidades...");
					break;
				}
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
					[pos, vel] = crearPosiVel(elementaries[i].cantidadOriginal, i, elementaries[i].radio * 2);
					elementaries[i].posiciones = pos;
					elementaries[i].velocidades = vel;
				} else {
					pos = elementaries[i].posiciones;
					vel = elementaries[i].velocidades;
				}
				
				positionsArray.set(pos, offset);
				velocitiesArray.set(vel, offset);
	
				offset += elementaries[i].cantidadOriginal*4;
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
	function cropParticlesBuffers() {

		const buffer = new ArrayBuffer(N*32) //16 bytes pos, 16 bytes vel

		const newPosArray = new Float32Array(buffer, 0, N*4);
		const newVelArray = new Float32Array(buffer, N*16);

		for (let i=0, offset=0; i < elementaries.length; i++) {
			newPosArray.set(elementaries[i].posiciones, offset);
			newVelArray.set(elementaries[i].velocidades, offset);
			offset += elementaries[i].posiciones.length;
		}

		// we also have to update N and cant in the buffer:
		updateDatosElementariesBuffer();

		createPosiVelsGPUBuffers(newPosArray.byteLength, newVelArray.byteLength);

		device.queue.writeBuffer(GPUBuffers.positionBuffers[frame%2], 0, newPosArray);
		device.queue.writeBuffer(GPUBuffers.velocities, 0, newVelArray);

	}
	function updateActiveRules() {
		const activeRules = [];

		for (let rule of rules) {
			const targetIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.targetName});
			const sourceIndex = elementaries.findIndex(elementary => {return elementary.nombre == rule.sourceName});
	
			if (targetIndex === -1 || sourceIndex ===-1) { continue; }
			activeRules.push(rule);
		}
	
		const Nr = activeRules.length;
	
		paramsArrays.Nr.set([Nr]);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.Nr.byteOffset, paramsArrays.Nr);
		return activeRules;
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
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.pStyle.byteOffset, paramsArrays.pStyle);
		flags.editPStyle = false;
	}
	function writeRNGSeedToBuffer() {
		paramsArrays.seeds.set([
			rng() * 100,
			rng() * 100, // seed.xy
			1 + rng(),
			1 + rng(), // seed.zw
		])
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.seeds.byteOffset, paramsArrays.seeds);
	}
	function writeLimsToBuffer() {
		paramsArrays.lims.set(sceneSettings.lims);
		device.queue.writeBuffer(GPUBuffers.params, paramsArrays.lims.byteOffset, paramsArrays.lims);
		device.queue.writeBuffer(GPUBuffers.scenarioData, 0, paramsArrays.lims);
		flags.editLims = false;
	}

	// Other
	function renderIfPaused(offset = -1) {
		if (paused) {
			const encoder = device.createCommandEncoder();
			render(encoder, Math.max(frame + offset, 0)); // -1 porque al final del loop anterior se incrementó.
			device.queue.submit([encoder.finish()]);
		}
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
	posInfo = document.getElementById("positioninfo"),
	displayTiming = document.getElementById("performanceinfo"),
	// panel de opciones
	panelTitle = document.getElementById("controlPanelTitle"),
	CPOptions = document.getElementById("controlPanelOptions"),
	markers = {
		1: document.getElementById("marker1"),
		2: document.getElementById("marker2"),
		3: document.getElementById("marker3"),
		4: document.getElementById("marker4"),
	},
	// opciones
	pauseButton = document.getElementById("pausebutton"),
	stepButton = document.getElementById("stepbutton"),
	resetButton = document.getElementById("resetbutton"),

	seedInput = document.getElementById("seed"),

	bgColorPicker = document.getElementById("bgcolorpicker"),
	pStyleRange = document.getElementById("pstyle"),

	volumeRange = document.getElementById("volume"),
	clickSound = document.getElementById("clicksound"),

	sceneOptionsTitle = document.getElementById("3doptionstitle"),
	sceneOptionsPanel = document.getElementById("3doptions"),
	sceneControls = {
		inputs: {
			camSpeed: document.getElementById("camspeed"),
			fov: document.getElementById("fov"),
			lims: {
				x: document.getElementById("xlim"),
				y: document.getElementById("ylim"),
				z: document.getElementById("zlim"),
			},
			initialEyePos: 1,
			initialYRot: 1,
		},
		applyButton: document.getElementById("sceneapply"),
		bordersButton: document.getElementById("bordersbutton"),
	},
	camSpeedLabel = document.getElementById("camspeedlabel"),
	fovLabel = document.getElementById("fovlabel"),

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
	currentCant = document.getElementById("c.cantnow"),

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

		const isTextOrNumberInput = event.target.type === "text" || event.target.type === "number";

		if (isTextOrNumberInput || event.ctrlKey) { return; }

		if (event.target.type === "range") { event.target.blur(); }

		keysPressed.add(event.code);

		switch (event.code){
			case "Space":
				event.preventDefault();
				pausar(); playSound(clickSound);
				break;
			case "KeyR":
				resetear(); playSound(clickSound);
				break;
			case "KeyE":
				stepear(); playSound(clickSound);
				break;
			case "KeyQ":
				hideCPOptions();
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
			case "KeyT":
				switchVisibilityAttribute(debugInfo);
				break;
			case "KeyB":
				sceneControls.bordersButton.click();
			case camControls.reset:
			case camControls.left:
			case camControls.right:
			case camControls.forward:
			case camControls.backward:
			case camControls.up:
			case camControls.down:
			case camControls.rotLeft:
			case camControls.rotRight:
			case camControls.test:
				event.preventDefault();
				if (!flags.runningCameraLoop) {
					requestAnimationFrame(cameraLoop);
					flags.runningCameraLoop = true;
				}
				break;
		}
	});
	document.addEventListener("keyup", (event) => {
		keysPressed.delete(event.code);
		if (!keysPressed.size) flags.runningCameraLoop = false;
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
	sceneOptionsTitle.onclick = _=> switchVisibilityAttribute(sceneOptionsPanel);
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

	// Canvas color
	bgColorPicker.oninput = _=> {
		styleSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1);
		renderIfPaused();
	}

	// Particles stye 
	pStyleRange.oninput = _=> { 
		playSound(clickSound, false);
		applyParticlesStyle();
	}

	// Particle placing
	canvas.onmousedown = (ev)=> {
		if (ev.buttons !==1) { 
			keysPressed.clear();
			return;
		} else if (!placePartOnClic) return;

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
		
		const [dx, dy] = getMouseDeltas(ev);

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

		const [dx, dy] = getMouseDeltas(ev);

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

		// partiControls.cantInput.placeholder = elem.cantidad;
		currentCant.innerText = elementaries[i].cantidad;

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

	for (const input in ambientControls.inputs) {
		ambientControls.inputs[input].onchange = _=> enableIfChanged(ambientControls.updateButton, markers[1], ambientControls.inputs);
	}
	ambientControls.inputs.bounce.oninput = _=> setAutomaticInputElementWidth(ambientControls.inputs.bounce, 3, 12, 0);
	ambientControls.updateButton.onclick = _=> {
		if (ambientControls.updateButton.classList.contains("disabled")) { return; }
		playSound(clickSound);
		applyAmbient();
	}

	// 3D / scene
	for (const input in sceneControls.inputs.lims) {
		sceneControls.inputs.lims[input].onchange = _=> enableIfChanged(sceneControls.applyButton, markers[4], sceneControls.inputs.lims);
	}
	sceneControls.applyButton.onclick = _=> {
		if (sceneControls.applyButton.classList.contains("disabled")) { return; }
		playSound(clickSound);
		applyLims();
	}
	sceneControls.inputs.fov.oninput = _=> {
		sceneSettings.fov = parseFloat(sceneControls.inputs.fov.value);
		updateCamera();
		renderIfPaused();
	}
	fovLabel.onclick = _=> {
		sceneSettings.fov = sceneSettings.fovDefault;
		sceneControls.inputs.fov.value = sceneSettings.fov;
		updateCamera();
		renderIfPaused();
		playSound(clickSound);
	}
	sceneControls.inputs.camSpeed.oninput = _=> {
		sceneSettings.baseCamSpeed = parseFloat(sceneControls.inputs.camSpeed.value);
	}
	camSpeedLabel.onclick = _=> {
		sceneSettings.baseCamSpeed = sceneSettings.baseCamSpeedDefault;
		sceneControls.inputs.camSpeed.value = sceneSettings.baseCamSpeed;
		playSound(clickSound);
	}
	sceneControls.bordersButton.onclick = _=> {
		flags.renderScenario = !flags.renderScenario;
		renderIfPaused();
		switchClass(sceneControls.bordersButton, "switchedoff");
	}

	// Window focus
	window.onfocus = _=> keysPressed.clear();
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

	sceneControls.inputs.lims.x.placeholder = sceneSettings.lims[0];
	sceneControls.inputs.lims.y.placeholder = sceneSettings.lims[1];
	sceneControls.inputs.lims.z.placeholder = sceneSettings.lims[2];

	sceneControls.inputs.camSpeed.value = sceneSettings.baseCamSpeedDefault;
	sceneControls.inputs.fov.value = sceneSettings.fovDefault;

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
/*
hideCPOptions();
switchVisibilityAttribute(sceneOptionsPanel);
switchVisibilityAttribute(creadorPartPanel);*/

// INICIALIZAR WEBGPU

	// Vértices
	const v = 1; // ojo!: afecta el shader
	const vertices = new Float32Array([
		//   X,    Y,
		-v, -v, // Triangle 1
		v, -v,
		v,  v,
				
		-v,  v,	// Triangle 2 (only new verts)
	]);
	const vertIndices = new Uint16Array([
		0,1,2,	// T1
		2,3,0,	// T2
	]);

	const vertexBuffer = device.createBuffer({
		label: "Particle vertices",
		size: vertices.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, vertices);

	const indexBuffer = device.createBuffer({
		label: "Vertex index for particle vertices",
		size: vertIndices.byteLength,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(indexBuffer, 0, vertIndices);

	const vertexBufferLayout = {
		arrayStride: 8, 			// cada vertex ocupa 8 bytes (2 *4-bytes)
		attributes:[{ 				// array que es un atributo que almacena cada vertice (BLENDER!!!)
			format: "float32x2", 	// elijo el formato adecuado de la lista de GPUVertexFormat
			offset: 0, 				// a cuántos bytes del inicio del vertice empieza este atributo.
			shaderLocation: 0, 		// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
		}]
	};

	// Scenario vertices and indices. The vertices are scaled to lims by the vertex shader
	const [vertices2, vertIndices2] = boxMesh([1, 1, 1], true); 

	const vertexBuffer2 = device.createBuffer({
		label: "Walls vertices indexed",
		size: vertices2.byteLength, // 12 tris * 3 vert per tri * 12 bytes per tri
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
	});
	device.queue.writeBuffer(vertexBuffer2, 0, vertices2);

	const indexBuffer2 = device.createBuffer({
		label: "Vertex index for walls vertices",
		size: vertIndices2.byteLength,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(indexBuffer2, 0, vertIndices2);

	// Non-indexed scenario vertices (for testing).
	const vertices3 = boxMesh([1, 1, 1]);
	const vertexBuffer3 = device.createBuffer({
		label: "Walls vertices",
		size: vertices3.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
	});
	device.queue.writeBuffer(vertexBuffer3, 0, vertices3);

	// texture y su view, para multisampling (MSAA)

	textureView = getTextureView(ambient.canvasDims);

	depthTextureView = getDepthTextureView(ambient.canvasDims);

	const renderPassDescriptor = {	// Parámetros para el render pass que se ejecutará cada frame
		colorAttachments: [{		// es un array, de momento sólo hay uno, su @location en el fragment shader es entonces 0
			view: textureView,
			resolveTarget: context.getCurrentTexture().createView(), // para multisampling. Sin él, view sería esto.
			loadOp: "clear",
			clearValue: styleSettings.bgColor,
			storeOp: "store",
		}],
		depthStencilAttachment: {
			view: depthTextureView,
			depthClearValue: 1.0,
			depthLoadOp: "clear",
			depthStoreOp: "store",
		},
	};

	// Shaders

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader3D(),
	});
	const wallShaderModule = device.createShaderModule({
		label: "Walls shader",
		code: wallShader3D(),
	});
	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader3D(WORKGROUP_SIZE),
	})

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
			binding: 4, // Datos elementaries (cantidades, radio, color)
			visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 6, // render perspective
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: { type: "uniform"}
		}, {
			binding: 7, // atomic
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage"}
		}]
	});


	// Pipelines

	const pipelineLayout = device.createPipelineLayout({
		label: "Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayoutPos, bindGroupLayoutResto],
	}); // El orden de los bind group layouts tiene que coincider con los atributos @group en el shader

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
				format: canvasFormat,
				blend: { //blend mode with default values
					color: {
						operation: "add",
						srcFactor: "one",
						dstFactor: "one-minus-src-alpha", // default "zero"
					},
					alpha: {
						operation: "add",
						srcFactor: "one",
						dstFactor: "one-minus-src-alpha",
					},
				}
			}]
		},
		multisample: {
			count: sampleCount,
		},
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: "less",
			format: "depth24plus",
		},
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

	// Crear render pipelines
	const particleRenderPipeline = device.createRenderPipeline(renderPipelineDescriptor);

	const wallRenderPipeline = device.createRenderPipeline({
		layout: "auto",
		vertex: {
			module: wallShaderModule,
			entryPoint: "vertexMain",
			buffers:[{
					arrayStride: 12,
					attributes:[{
						format: "float32x3",
						offset: 0,
						shaderLocation: 0,
					}]
				},
			],
		},
		fragment: {
			module: wallShaderModule,
			entryPoint: "fragmentMain",
			targets: [{
				format: canvasFormat,
				blend: { //blend mode with default values
					color: {
						operation: "add",
						srcFactor: "one",
						dstFactor: "one-minus-src-alpha", // default "zero"
					},
					alpha: {
						operation: "add",
						srcFactor: "one",
						dstFactor: "one-minus-src-alpha",
					},
				}
			}],
		},
		multisample: {
			count: sampleCount,
		},
		depthStencil: {
			depthWriteEnabled: false, //permite que esta pipeline escriba al depth
			depthCompare: "less",
			format: "depth24plus",
		},
		
	})


	// Crear compute pipelines
	const simulationPipeline = device.createComputePipeline(simulationPipelineDescriptor);

	// Buffers

	// Parámetros de longitud fija (por lo tanto buffers de size fijo)

	const paramsBufferSize =
		8 + 4 + 4 +		// [canvasDims], N, Ne
		4 + 8 + 4 +   	// Nr, [frictionInv, bounceF], padding
		8 + 8 + 		// [borderStart, spherical], padding
		16 + 			// [4 RNGSeeds]
		12 + 4;			// [3 lims], padding

	const paramsArrBuffer = new ArrayBuffer(paramsBufferSize);

	const paramsArrays = {

		canvasDims: new Float32Array(paramsArrBuffer, 0, 2), // offset en bytes, longitud en cant de elementos
		N: new Uint32Array(paramsArrBuffer, 8, 1),			//  Cantidad total de partículas
		Ne: new Uint32Array(paramsArrBuffer, 12, 1),		//  Cantidad de elementaries

		Nr: new Uint32Array(paramsArrBuffer, 16, 1),		//  Cantidad de reglas activas (que involucran elementaries cargados)
		ambient: new Float32Array(paramsArrBuffer, 20, 2),	// Parámetros de entorno
		// 4 bytes of padding

		pStyle: new Float32Array(paramsArrBuffer, 32, 2),	// Estilo visual de las partículas
		// 8 bytes of padding

		seeds: new Float32Array(paramsArrBuffer, 48, 4),	// Seed para el rng en los shaders

		lims: new Float32Array(paramsArrBuffer, 64, 3),		// Paredes para colisiones
		// 4 bytes of padding

	}


	paramsArrays.lims.set(sceneSettings.lims)

	const GPUBuffers = {

		positionBuffers: [],
		velocities: undefined,
		datosElementaries: undefined,
		rules: undefined,

		params: device.createBuffer({
			label: "Params buffer",
			size: paramsBufferSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		}),

		renderPerspective: device.createBuffer({
			label: "Render perspective buffer",
			size: 16*4,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		}),

		scenarioData: device.createBuffer({
			label: "Scenario data buffer",
			size: 12,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		}),

		atomicStorage: device.createBuffer({
			label: "Atomic storage buffer",
			size: 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
		})
	};
	
	device.queue.writeBuffer(GPUBuffers.scenarioData, 0, paramsArrays.lims);
	
	updateCamera();

	const scenarioBindGroups = [
		device.createBindGroup({
			label: "Scenario BindGroup",
			layout: wallRenderPipeline.getBindGroupLayout(0),
			entries: [{
				binding: 0,
				resource: { buffer: GPUBuffers.renderPerspective }
			}, {
				binding: 1,
				resource: { buffer: GPUBuffers.scenarioData }
			}],
		}),
	];
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

	// Escena (lims)
	if (flags.editLims) {
		writeLimsToBuffer();
		cropParticlesBuffers();
		msg += "lims/";
	}

	// Reglas
	if (flags.updateRules) {
		const activeRules = updateActiveRules(); // Reglas parte A
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

	if (N === 0) {
		console.log("Updated sim params: " + msg + ".");
		flags.updateSimParams = false;
		return;
	}

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
					binding: 4,
					resource: { buffer: GPUBuffers.datosElementaries }
				}, { // binding 5 is reserved for legacy reasons
					binding: 6,
					resource: { buffer: GPUBuffers.renderPerspective }
				}, {
					binding: 7,
					resource: { buffer: GPUBuffers.atomicStorage }
				}
			],
		}),

	];

	// Pipelines pueden ir acá

	// Actualizar workgroup counts para compute passes
	workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	//console.log( `N / workgroup size: ${N} / ${WORKGROUP_SIZE} = ${N/WORKGROUP_SIZE}\nworkgroup count: ${workgroupCount}`);

	console.log("Updated sim params: " + msg + ".");
	flags.updateSimParams = false;
}

// Funciones para el loop principal

function render(encoder, frame) {
	// Actualizar color de fondo.
	renderPassDescriptor.colorAttachments[0].clearValue = styleSettings.bgColor; 

	if (sampleCount > 1) {
		// view is the the texture view that will be written to at the end 
		renderPassDescriptor.colorAttachments[0].view = textureView;
		// resolveTarget is the texture view that will be written to after rendering each sample
		renderPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
	} else {
		renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
		renderPassDescriptor.colorAttachments[0].resolveTarget = undefined;
		renderPassDescriptor.depthStencilAttachment.view = depthTextureView;
	}
	
	const pass = encoder.beginRenderPass(renderPassDescriptor);

	// draw opaque stuff first
	if (N) {
		pass.setPipeline(particleRenderPipeline);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.setIndexBuffer(indexBuffer, "uint16");
		pass.setBindGroup(0, bindGroups[frame % 2]);
		pass.setBindGroup(1, bindGroups[2]);
		pass.drawIndexed(vertIndices.length, N);
	}

	// draw transparent stuff
	if (flags.renderScenario) {
		pass.setPipeline(wallRenderPipeline);
		if (flags.indexedScenario) {
			pass.setVertexBuffer(0,vertexBuffer2);
			pass.setIndexBuffer(indexBuffer2, "uint16");
			pass.setBindGroup(0, scenarioBindGroups[0]);
			pass.drawIndexed(vertIndices2.length);
		} else {
			pass.setVertexBuffer(0,vertexBuffer3); // It's a box that surrounds the particles
			pass.setBindGroup(0, scenarioBindGroups[0]);
			pass.draw(vertices3.length/3);
		}
	}

	pass.end();
}

function computeNextFrame(encoder, frame) {
	if (N) { // Aunque no haya reglas activas, las partículas pueden estar moviéndose. Hay que calcular su pos.

		writeRNGSeedToBuffer();
		
		// Calcular simulación (actualizar posiciones y velocidades)
		const computePass = encoder.beginComputePass();
		computePass.setPipeline(simulationPipeline);
		computePass.setBindGroup(0, bindGroups[frame % 2]); // posiciones alternantes
		computePass.setBindGroup(1, bindGroups[2]); // lo demás
		/* El compute shader se ejecutará N veces. El workgroup size es 64, entonces despacho ceil(N/64) workgroups, todos en el eje x. */
		computePass.dispatchWorkgroups(workgroupCount, 1, 1); // Este vec3<u32> tiene su propio @builtin en el compute shader.
		computePass.end();
	}
}

function updateCamera() {

	viewProjectionMatrix = new Mat4();
	viewProjectionMatrix.rotate(rotYCurrent, rotAxis);
	viewProjectionMatrix.translate(eyePosition.scale(-1, ph));
	
	eyeDirection[0] = viewProjectionMatrix[8];
	eyeDirection[1] = viewProjectionMatrix[9];
	eyeDirection[2] = -viewProjectionMatrix[10];

	projectionMatrix = new Mat4();

	projectionMatrix.perspectiveZO(sceneSettings.fov, canvas.width / canvas.height, nearClip, farClip);
	projectionMatrix.multiply(viewProjectionMatrix);

	device.queue.writeBuffer(GPUBuffers.renderPerspective, 0, projectionMatrix);

	updatePosInfoPanel();
}

// ANIMATION LOOP

function cameraLoop() {

	if (keysPressed.has(camControls.reset)) {
		eyePosition.toDefault();
		rotYCurrent = 0;
	} else {

		const speedMultiplier = keysPressed.has(camControls.slow) ? 0.2 : 1;

		const camSpeed = sceneSettings.baseCamSpeed * speedMultiplier;
	
		eyeDirection.cross(up, right).scale(camSpeed); 	// update right vec3
		eyeDirection.scale(camSpeed, forward)			// update forward vec3
	
		if (keysPressed.has(camControls.left)) {eyePosition.subtract(right);} //eyePosition[0] -= camSpeed;
		
		if (keysPressed.has(camControls.right)) {eyePosition.add(right);}	
	
		if (keysPressed.has(camControls.forward)) {eyePosition.add(forward);}	
		
		if (keysPressed.has(camControls.backward)) {eyePosition.subtract(forward);}
	
		if (keysPressed.has(camControls.up)) {eyePosition[1] += camSpeed;}
	
		if (keysPressed.has(camControls.down)) {eyePosition[1] -= camSpeed;}
		
		if (keysPressed.has(camControls.rotLeft)) 	rotYCurrent -= rotateSpeed * speedMultiplier;
		
		if (keysPressed.has(camControls.rotRight)) 	rotYCurrent += rotateSpeed * speedMultiplier;
	}

	updateCamera();

	renderIfPaused()

	if (flags.runningCameraLoop) requestAnimationFrame(cameraLoop);
}

async function newFrame() {
	
	if (paused && !stepping) return;

	if (flags.updateSimParams) updateSimulationParameters();

	const encoder = device.createCommandEncoder();

	timestamp(0, encoder);

	render(encoder, frame);

	timestamp(1, encoder);

	computeNextFrame(encoder, frame);

	timestamp(2, encoder);

	device.queue.submit([encoder.finish()]);

	if (frame % 30 === 0) displayTimestampResults();


	//readPrintResetAtomic(device, GPUBuffers.atomicStorage);
	//debuggingRead(device, GPUBuffers.velocities);

	
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

//bug: clic derecho mientras se mueve la camara

// probar performance si paso todo lo que puedo a per-instance vertex attributes

/*
PERMITIR APLICAR PARTÍCULAS SIN RESETEAR POSIVELS. WE HAVE THE TECHNOLOGY!
*/
/* Ctrl + Arrastrar para colocar un trazo de partículas*/
/* Pasar los parámetros pertinentes mediante writebuffer en lugar de recrear nuevos buffers */
/* Funciones para quitar o agregar partículas. permite mergers/eaters */
/* Antialiasing / renderizar a mayor resolución */
/* Fondo con efectos con shader */
