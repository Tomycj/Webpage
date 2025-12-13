export class FrameLoopController_Main {

	worker;
	static get COMMAND_IDENTIFIER() {return "frameloop"};

	#ui;
	#paused = true;
	get paused() {return this.#paused}

	#stepping = false;
	get stepping() {return this.#stepping}

	#renderingAsPaused = false;
	get renderingAsPaused() {return this.#renderingAsPaused}

	/**
	 * @param {Worker} worker
	 * @param {{pauseButton: HTMLElement}} ui Dictionary of required HTML UI elements.
	 */
	constructor(worker, ui) {
		this.#ui = ui;
		this.worker = worker;

		this.worker.addEventListener("message", (ev)=>{

			if (ev.data[0] !== FrameLoopController_Main.COMMAND_IDENTIFIER) return;

			if (ev.data[1] === "ui update confirmation") {
				this.#ui.pauseButton.classList.remove("disabled", "non-clickable");
			}
		});
	}

	pausar() {
		if (!this.#paused) {
			this.#ui.pauseButton.innerText = "Resumir";
		} else {
			this.#ui.pauseButton.innerText = "Pausa";
		}
		this.#paused = !this.#paused;
		this.#stepping = false;
		this.sendMessage("pause/play", true);

	}
	stepear() {
		this.#stepping = true;
		this.#paused = true;
		this.#ui.pauseButton.innerText = "Resumir";
		this.sendMessage("step", false);

	}
	setFrameZero() {
		this.sendMessage("setFrameZero", false);
	}
	requestRenderAsPaused() {
		if (this.paused && !this.renderingAsPaused) {
			this.#renderingAsPaused = true;
			this.sendMessage("requestRenderAsPaused", true);
		}
	}
	sendMessage(command, awaitConfirmation) {
		this.worker.postMessage([FrameLoopController_Main.COMMAND_IDENTIFIER, command, awaitConfirmation]);
		if (awaitConfirmation) {
			this.#ui.pauseButton.classList.add("disabled", "non-clickable");
		}
	}
};

export class FrameLoopController_Worker {
	#device;
	#frameLoopFn;
	#renderFn;

	#paused = true;
	get paused() {return this.#paused}

	#stepping = false;
	get stepping() {return this.#stepping}

	#renderingAsPaused = false;
	get renderingAsPaused() {return this.#renderingAsPaused}

	#frame = 0;
	get frame() {return this.#frame}
	
	#fps = 0;
	get fps() {return this.#fps}
	
	#frameCounter = 0;
	#refTime;
	#frameLoopID = null;

	/**
	 * @param {GPUDevice} device 
	 * @param {function} frameLoopFn Function that advances a simulation/animation step and renders the scene.
	 * @param {function(GPUCommandEncoder)} renderFn Function that renders the scene without advancing a simulation/animation step.
	 */
	constructor(device, frameLoopFn, renderFn) {
		this.#device = device;
		this.#frameLoopFn = frameLoopFn;
		this.#renderFn = renderFn;

		addEventListener("message", (ev)=> {
			if (ev.data[0] !== FrameLoopController_Main.COMMAND_IDENTIFIER) return;

			switch (ev.data[1]) {
				case "pause/play":
					this.pausar();
					break;
				case "step":
					this.stepear();
					break;
				case "setFrameZero":
					this.setFrameZero();
					break;
				case "requestRenderAsPaused":
					this.requestRenderAsPaused();
					break;
				default:
					console.warn("Unknown frameloop message:", ev.data[1]);
					break;
			}
			if (ev.data[2]) this.#postUiUpdateConfirmation();

		});

	}

	pausar() {
		if (!this.#paused) {			
			cancelAnimationFrame(this.#frameLoopID);
		} else {
			this.#refTime = performance.now();
			this.#frameCounter = 0;
			this.#frameLoopID = requestAnimationFrame(this.#frameLoopFnWrapper);
		}
		this.#paused = !this.#paused;
		this.#stepping = false;
		
	}
	stepear() {
		this.#stepping = true;
		this.#paused = true;
		this.#frameLoopID = requestAnimationFrame(this.#frameLoopFnWrapper);
	}
	setFrameZero() {
		this.#frame = 0;
	}
	requestRenderAsPaused() {
		if (this.paused && !this.renderingAsPaused) {
			this.#renderingAsPaused = true;
			requestAnimationFrame(this.#renderAsPaused);
		}
	}

	#renderAsPaused = _=>{
		const encoder = this.#device.createCommandEncoder();
		this.#renderFn(encoder);
		this.#device.queue.submit([encoder.finish()]);
		this.#renderingAsPaused = false;
	};
	#frameLoopFnWrapper = _=> {
		if (this.#paused && !this.#stepping) return;

		this.#frameLoopFn();

		this.#frame++; this.#frameCounter++;
		const timeNow = performance.now();
		if (timeNow - this.#refTime >= 1000) {
			this.#fps = this.#frameCounter;
			this.#frameCounter = 0;
			this.#refTime = timeNow;
		}
		
		if ( !this.#stepping ) { this.#frameLoopID = requestAnimationFrame(this.#frameLoopFnWrapper); }
	};
	#postUiUpdateConfirmation() {postMessage([FrameLoopController_Main.COMMAND_IDENTIFIER, "ui update confirmation"])}
};