
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

export async function inicializarCells(showTitle=true){
	const estatus = document.getElementById("estatus");

	//Revisar si existe el objeto que sirve como punto de partida para acceder a la GPU. Es para revisar si el dispositivo es compatible con WebGPU
	if (!navigator.gpu) {
		navigator.gpu;
		estatus.innerText = "Error: Este navegador/equipo parece no ser compatible con WebGPU.";
		throw new Error("WebGPU not supported on this browser.");
	}
	
	//Solicitar un GPUAdapter, que es cómo se representa una pieza del GPU. Devuelve un objeto tipo promesa, por eso se lo llama con await
	const adapter = await navigator.gpu.requestAdapter(); //puede recibir argumentos extra sobre qué clase de GPU prefiere usar (performance vs power etc)
	if (!adapter){
		estatus.innerText = "Error: No se detectó GPU. Asegúrese de usar un dispositivo con GPU (placa de video / acelerador de gráficos).";
		throw new Error("No se encontró GPUAdapter.");
	} // si no hay adapter, puede devolver null
	
	const canvas = document.querySelector("canvas");
	const container = document.getElementById("canvascontainer");

	if (!showTitle) {
		estatus.hidden = true;
		[canvas.width, canvas.height] = autoCanvasDims(container);
	} else {
		[canvas.width] = autoCanvasDims(container, "width");
	}
	canvas.hidden = false;

	estatus.innerText= "La GPU de tu equipo está calculando y renderizando esto!"

	let device;
	let timer = false;
	const requiredLimits = {
		//minStorageBufferOffsetAlignment: 16
		//maxStorageBuffersPerShaderStage: 8
	}
	try{
		device = await adapter.requestDevice({
			requiredFeatures: ["timestamp-query"],
			/* ^ Guarda que es inseguro porque facilita ataques que usan el timing de la gpu 
			C:\Program Files (x86)\Google\Chrome\Application>chrome.exe --disable-dawn-features=disallow_unsafe_apis */
			requiredLimits: requiredLimits
		});
		console.log("Advertencia: usando device con timestamp-query.");
		timer = true;
	} catch(error) {
		device = await adapter.requestDevice({
			requiredLimits: requiredLimits,
		});
		console.log("Usando device sin timestamp-query.");
		console.log("[Chrome] Para habilitar, cerrar el navegador y reabrirlo desde la consola con la flag --disable-dawn-features=disallow_unsafe_apis.");
	}

	const context = canvas.getContext("webgpu");
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device: device,
		format: canvasFormat, //es el texture format que el context debería usar
		alphaMode: "premultiplied", // no estoy seguro si hace falta
	});
	
	return [device, canvas, canvasFormat, context, timer];
	
}

export function autoCanvasDims(container, dims="widthheight") {

	const pixelRatio = window.devicePixelRatio || 1;
	if (pixelRatio !== 1) { console.log("Pixel ratio: " + pixelRatio); }

	const bodyMargin = parseInt(window.getComputedStyle(document.body).margin);
	switch (dims) {
		case "heightwidth":
		case "widthheight":
			return [container.clientWidth, window.innerHeight - bodyMargin * 2 * pixelRatio]
		case "width":
			return [container.clientWidth,,]
		case "height":
			return [,window.innerHeight - bodyMargin * 2 * pixelRatio];
		default:
			throw new Error("dims must be 'width', 'height', or their concatenation");
	}
}

/**
 * Represents a 4x4 matrix (column-major)
 */
export class Mat4 extends Float32Array {
	/**
	 * Creates an identity 4x4 matrix.
	 * @module Mat4
	 */
	constructor() {
		super(16);
		this[0] = 1;
		this[5] = 1;
		this[10] = 1;
		this[15] = 1;
	}
    /**
     * Generates a perspective projection matrix suitable for WebGPU with the given bounds.
     * The near/far clip planes correspond to a normalized device coordinate Z range of [0, 1],
     * which matches WebGPU/Vulkan/DirectX/Metal's clip volume.
     * Passing null/undefined/no value for far will generate infinite projection matrix.
     *
     * @param {number} fovy Vertical field of view in radians
     * @param {number} aspect Aspect ratio. typically viewport width/height
     * @param {number} near Near bound of the frustum
     * @param {number} far Far bound of the frustum, can be null or Infinity
     */
	perspectiveZO(fovy, aspect, near, far) {
		const f = 1.0 / Math.tan(fovy / 2);
	
		this[0] = f / aspect;
		this[1] = 0;
		this[2] = 0;
		this[3] = 0;
		this[4] = 0;
		this[5] = f;
		this[6] = 0;
		this[7] = 0;
		this[8] = 0;
		this[9] = 0;
		this[11] = -1;
		this[12] = 0;
		this[13] = 0;
		this[15] = 0;
	
		if (far != null && far !== Infinity) {
			const nf = 1 / (near - far);
			this[10] = far * nf;
			this[14] = far * near * nf;
		} else {
			this[10] = -1;
			this[14] = -near;
		}

	}
    /**
     * Translates the matrix by the given 3d vector.
     *
     * @param {Float32Array} v vector to translate by.

     */
	translate(v) {
		const x = v[0],
		y = v[1],
		z = v[2];
	
		this[12] = this[0] * x + this[4] * y + this[8] * z + this[12];
		this[13] = this[1] * x + this[5] * y + this[9] * z + this[13];
		this[14] = this[2] * x + this[6] * y + this[10] * z + this[14];
		this[15] = this[3] * x + this[7] * y + this[11] * z + this[15];

	}

	/**
     * Multiply the matrix by b (self = self * b).
     *
     * @param {Mat4} b matrix to multiply by.
     */
	multiply(b) {
		const a00 = this[0],
			a01 = this[1],
			a02 = this[2],
			a03 = this[3];
		const a10 = this[4],
			a11 = this[5],
			a12 = this[6],
			a13 = this[7];
		const a20 = this[8],
			a21 = this[9],
			a22 = this[10],
			a23 = this[11];
		const a30 = this[12],
			a31 = this[13],
			a32 = this[14],
			a33 = this[15]; 
  
		let b0 = b[0],
			b1 = b[1],
			b2 = b[2],
			b3 = b[3];
		this[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		this[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		this[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		this[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
		b0 = b[4];
		b1 = b[5];
		b2 = b[6];
		b3 = b[7];
		this[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		this[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		this[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		this[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
		b0 = b[8];
		b1 = b[9];
		b2 = b[10];
		b3 = b[11];
		this[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		this[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		this[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		this[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
		b0 = b[12];
		b1 = b[13];
		b2 = b[14];
		b3 = b[15];
		this[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		this[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		this[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		this[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	}
    /**
     * Multiply a by the matrix (self = a * self).
     *
     * @param {Mat4} a matrix to multiply.
     */
    multiply2(a) {
		const b00 = this[0],
			b01 = this[1],
			b02 = this[2],
			b03 = this[3];
		const b10 = this[4],
			b11 = this[5],
			b12 = this[6],
			b13 = this[7];
		const b20 = this[8],
			b21 = this[9],
			b22 = this[10],
			b23 = this[11];
		const b30 = this[12],
			b31 = this[13],
			b32 = this[14],
			b33 = this[15]; 
  
		this[0] = a[0] * b00 + a[4] * b01 + a[8] * b02 + a[12] * b03;
		this[1] = a[1] * b00 + a[5] * b01 + a[9] * b02 + a[13] * b03;
		this[2] = a[2] * b00 + a[6] * b01 + a[10] * b02 + a[14] * b03;
		this[3] = a[3] * b00 + a[7] * b01 + a[11] * b02 + a[15] * b03;

		this[4] = a[0] * b10 + a[4] * b11 + a[8] * b12 + a[12] * b13;
		this[5] = a[1] * b10 + a[5] * b11 + a[9] * b12 + a[13] * b13;
		this[6] = a[2] * b10 + a[6] * b11 + a[10] * b12 + a[14] * b13;
		this[7] = a[3] * b10 + a[7] * b11 + a[11] * b12 + a[15] * b13;

		this[8] = a[0] * b20 + a[4] * b21 + a[8] * b22 + a[12] * b23;
		this[9] = a[1] * b20 + a[5] * b21 + a[9] * b22 + a[13] * b23;
		this[10] = a[2] * b20 + a[6] * b21 + a[10] * b22 + a[14] * b22;
		this[11] = a[3] * b20 + a[7] * b21 + a[11] * b22 + a[15] * b23;

		this[12] = a[0] * b30 + a[4] * b31 + a[8] * b32 + a[12] * b33;
		this[13] = a[1] * b30 + a[5] * b31 + a[9] * b32 + a[13] * b33;
		this[14] = a[2] * b30 + a[6] * b31 + a[10] * b32 + a[14] * b33;
		this[15] = a[3] * b30 + a[7] * b31 + a[11] * b32 + a[15] * b33;

	}

    /**
	 * Rotates the matrix by the given angle around the given axis
	 *
	 * @param {Number} rad the angle to rotate the matrix by
	 * @param {Float32Array} axis the axis to rotate around
	 */

	rotate( rad, axis) {
		var x = axis[0],
			y = axis[1],
			z = axis[2];
		var len = Math.hypot(x, y, z);
		var s, c, t;
		var a00, a01, a02, a03;
		var a10, a11, a12, a13;
		var a20, a21, a22, a23;
		var b00, b01, b02;
		var b10, b11, b12;
		var b20, b21, b22;

		if (len < 0.000001) {
			return null;
		}

		len = 1 / len;
		x *= len;
		y *= len;
		z *= len;
		s = Math.sin(rad);
		c = Math.cos(rad);
		t = 1 - c;
		a00 = this[0];
		a01 = this[1];
		a02 = this[2];
		a03 = this[3];
		a10 = this[4];
		a11 = this[5];
		a12 = this[6];
		a13 = this[7];
		a20 = this[8];
		a21 = this[9];
		a22 = this[10];
		a23 = this[11]; // Construct the elements of the rotation matrix

		b00 = x * x * t + c;
		b01 = y * x * t + z * s;
		b02 = z * x * t - y * s;
		b10 = x * y * t - z * s;
		b11 = y * y * t + c;
		b12 = z * y * t + x * s;
		b20 = x * z * t + y * s;
		b21 = y * z * t - x * s;
		b22 = z * z * t + c; // Perform rotation-specific matrix multiplication

		this[1] = a01 * b00 + a11 * b01 + a21 * b02;
		this[0] = a00 * b00 + a10 * b01 + a20 * b02;
		this[2] = a02 * b00 + a12 * b01 + a22 * b02;
		this[3] = a03 * b00 + a13 * b01 + a23 * b02;
		this[4] = a00 * b10 + a10 * b11 + a20 * b12;
		this[5] = a01 * b10 + a11 * b11 + a21 * b12;
		this[6] = a02 * b10 + a12 * b11 + a22 * b12;
		this[7] = a03 * b10 + a13 * b11 + a23 * b12;
		this[8] = a00 * b20 + a10 * b21 + a20 * b22;
		this[9] = a01 * b20 + a11 * b21 + a21 * b22;
		this[10] = a02 * b20 + a12 * b21 + a22 * b22;
		this[11] = a03 * b20 + a13 * b21 + a23 * b22;

	}

	/**
	 * Generates a orthogonal projection matrix with the given bounds.
	 * The near/far clip planes correspond to a normalized device coordinate Z range of [0, 1],
	 * which matches WebGPU/Vulkan/DirectX/Metal's clip volume.
	 *
	 * @param {number} left Left bound of the frustum
	 * @param {number} right Right bound of the frustum
	 * @param {number} bottom Bottom bound of the frustum
	 * @param {number} top Top bound of the frustum
	 * @param {number} near Near bound of the frustum
	 * @param {number} far Far bound of the frustum
	 */

	orthoZO(left, right, bottom, top, near, far) {
		var lr = 1 / (left - right);
		var bt = 1 / (bottom - top);
		var nf = 1 / (near - far);
		this[0] = -2 * lr;
		this[1] = 0;
		this[2] = 0;
		this[3] = 0;
		this[4] = 0;
		this[5] = -2 * bt;
		this[6] = 0;
		this[7] = 0;
		this[8] = 0;
		this[9] = 0;
		this[10] = nf;
		this[11] = 0;
		this[12] = (left + right) * lr;
		this[13] = (top + bottom) * bt;
		this[14] = near * nf;
		this[15] = 1;
  	}
}