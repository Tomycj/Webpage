/**
 * @param {{
 * 		panels: HTMLElement
 *		canvasInfo: HTMLElement
 *		pauseButton: HTMLElement
 *		stepButton: HTMLElement
 *		panelTitle: HTMLElement
 *		infoButton: HTMLElement
 *		CPOptions: HTMLElement
 *		infoPanel: HTMLElement
 *		debugInfo: HTMLElement
 *	}} ui 
 * @param {FrameLoopController} frameLoopController 
 */
export function configureEventHandling2D(ui, frameLoopController) {
	const {
		panels,
		canvasInfo,
		pauseButton,
		stepButton,
		panelTitle,
		infoButton,
		CPOptions,
		infoPanel,
		debugInfo,
	} = ui;
	
	canvasInfo.innerText = `${canvas.width} x ${canvas.height} (${(canvas.width/canvas.height).toFixed(2)})`;

	pauseButton.onclick = _=> {frameLoopController.pausar();}
	stepButton.onclick = _=> {frameLoopController.stepear();}
	panelTitle.onclick = _=> {CPOptions.hidden ^= true};
	infoButton.onclick = _=> {infoPanel.hidden ^= true};
	
	// Controles
	document.addEventListener("keydown", function(event) {
	
		const isTextOrNumberInput = event.target.type === "text" || event.target.type === "number";
	
		if (isTextOrNumberInput || event.ctrlKey) { return; }
	
		if (event.target.type === "range") { event.target.blur(); }
	
		switch (event.key){
			case " ":
				event.preventDefault();
				frameLoopController.pausar();
				break;
			case "s":
				frameLoopController.stepear();
				break;
			case "q":
				CPOptions.hidden ^= true;
				break;
			case "i":
				infoPanel.hidden ^= true;
				break;
			case "h":
				panels.hidden ^= true;
				break;
			case "t":
				debugInfo.hidden ^= true;
				break;
		}
	});
}