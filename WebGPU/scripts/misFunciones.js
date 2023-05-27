
/** Revisa si hay GPU, actualiza mensaje en elemento "estatus" y devuelve el adaptador y el canvas en un array de promesas */
export async function inicializar(){
const estatus = document.getElementById("estatus");

//Revisar si existe el objeto que sirve como punto de partida para acceder a la GPU. Es para revisar si el dispositivo es compatible con WebGPU
if (!navigator.gpu) {
	estatus.innerText = "Error: Este navegador parece no ser compatible con WebGPU, verifique que esté actualizado";
	throw new Error("WebGPU not supported on this browser.");
}

//Solicitar un GPUAdapter, que es cómo se representa una pieza del GPU. Devuelve un objeto tipo promesa, por eso se lo llama con await
const adapter = await navigator.gpu.requestAdapter(); //puede recibir argumentos extra sobre qué clase de GPU prefiere usar (performance vs power etc)
if (!adapter){
	estatus.innerText = "Error: No se detectó GPU. Asegúrese de usar un dispositivo con GPU (placa de video / acelerador de gráficos)";
	throw new Error("No se encontró GPUAdapter.");
} // si no hay adapter, puede devolver null

const canvas = document.querySelector("canvas"); canvas.hidden = false;
estatus.innerText= "La GPU de tu equipo está calculando y renderizando esto!"

return [adapter, canvas];

}


/** Revisa si hay GPU, actualiza mensaje en elemento "estatus" y devuelve el device, el canvas y el context configurado en un array de promesas */
export async function inicializarCells(){
	const estatus = document.getElementById("estatus");
	
	//Revisar si existe el objeto que sirve como punto de partida para acceder a la GPU. Es para revisar si el dispositivo es compatible con WebGPU
	if (!navigator.gpu) {
		navigator.gpu;
		estatus.innerText = "Error: Este navegador parece no ser compatible con WebGPU, verifique que esté actualizado";
		throw new Error("WebGPU not supported on this browser.");
	}
	
	//Solicitar un GPUAdapter, que es cómo se representa una pieza del GPU. Devuelve un objeto tipo promesa, por eso se lo llama con await
	const adapter = await navigator.gpu.requestAdapter(); //puede recibir argumentos extra sobre qué clase de GPU prefiere usar (performance vs power etc)
	if (!adapter){
		estatus.innerText = "Error: No se detectó GPU. Asegúrese de usar un dispositivo con GPU (placa de video / acelerador de gráficos)";
		throw new Error("No se encontró GPUAdapter.");
	} // si no hay adapter, puede devolver null
	
	const canvas = document.querySelector("canvas"); 

	const div = document.getElementById("canvascontainer");

	canvas.width = div.clientWidth;
	canvas.heigth = window.innerHeight;
	canvas.hidden = false;

	estatus.innerText= "La GPU de tu equipo está calculando y renderizando esto!"

	const device = await adapter.requestDevice();

	const context = canvas.getContext("webgpu");
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device: device,
		format: canvasFormat, //es el texture format que el context debería usar
	});
	
	return [device, canvas, canvasFormat, context];
	
	}
