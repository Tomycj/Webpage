import { FrameLoopController_Main } from "./modules/WebWorkerUtils.js";
import { configureEventHandling2D } from "./modules/standardEventHandling.js";


// DEFINE AND INITIALIZE PARAMETERS
const params = {
    seed:          null,
    N:             null,
    dt:            null,
    stepsPerFrame: null,
    g:             null,
    epsilon:       null,
    theta:         null,
    enableWasm:    null,
    maxTreeDepth:  null,
    drawFps:            null,
    drawFrameNumber:    null,
    drawLeaves:         null,
    drawRoot:           null,
    drawBHMargin:       null,
    vmax:           null,
    outliers:       null,
    vmaxOutliers:   null,
}
// Get parameters from sessionStorage or defaults in html
function initializeParams() {

    for (const paramName of Object.keys(params)) {

        const elem = document.getElementById("param-" + paramName);

        if (!elem) throw new SyntaxError("Parameter-setting HTMLElement not found");

        const storageKey = elem.id;
        const storedVal = sessionStorage.getItem(storageKey);

        let typedValue;
        if (elem.type === "number") {

            const valueStr = storedVal === null ? elem.value : storedVal;

            typedValue = Number(valueStr);

            elem.placeholder = valueStr;
            elem.value = "";
        }
        else if (elem.type === "checkbox") {

            elem.checked = storedVal === null ? elem.checked : Boolean(storedVal);

            typedValue = elem.checked;
        }
        else if (elem.type === "text") {

            const valueStr = storedVal === null ? elem.value : storedVal;

            typedValue = valueStr;

            elem.placeholder = valueStr || "Random";
            elem.value = valueStr;
        }
        else throw new TypeError("HTML input element asociated with this parameter must be of type number or checkbox");

        params[paramName] = typedValue;
    }
    document.getElementById("controlPanelOptions").hidden = false;
}
initializeParams();

// CREATE AND INITIALIZE WEB WORKER
const computeWorker = new Worker("./BHQuadtree_Worker.js", {type: "module"});

const offCanvas = document.getElementById("canvas").transferControlToOffscreen();
computeWorker.postMessage(
    ["initialize", offCanvas, params],
    [offCanvas]
);

// USER EVENT HANDLING
const loopControllerMain = new FrameLoopController_Main(
    computeWorker,
    {pauseButton: document.getElementById("pausebutton")}
);

const resetButton = document.getElementById("resetbutton");
const optionsPanel = document.getElementById("controlPanelOptions");

configureEventHandling2D({
    panels: document.getElementById("panels"),
    canvasInfo: document.getElementById("canvasinfo"),
    pauseButton: document.getElementById("pausebutton"),
    stepButton: document.getElementById("stepbutton"),
    panelTitle: document.getElementById("controlPanelTitle"),
    infoButton: document.getElementById("mostrarinfo"),
    CPOptions: optionsPanel,
    infoPanel: document.getElementById("infopanel"),
    debugInfo: document.getElementById("debuginfo"),
    }, loopControllerMain
);

resetButton.addEventListener("click", _=> computeWorker.postMessage(["reset"]));
document.addEventListener("keydown", (ev)=>{ if (ev.key === "r") resetButton.click(); });

optionsPanel.addEventListener("change", (ev)=>{

    const elem = ev.target;

    if (elem.constructor.name !== "HTMLInputElement") return;
    if (!elem.checkValidity() || !elem.id.startsWith("param-")) return;


    let typedValue;
    if (elem.type === "number") {

        elem.placeholder = elem.value;
        sessionStorage.setItem(elem.id, elem.value);

        typedValue = Number(elem.value);
    }
    else if (elem.type === "checkbox") {
        sessionStorage.setItem(elem.id, elem.checked ? "checked" : "");
        typedValue = elem.checked;

        const enableWasmCheckbox = document.getElementById("param-enableWasm");
        const bargenBHCheckbox = document.getElementById("param-drawBHMargin");
        if (enableWasmCheckbox.checked && bargenBHCheckbox.checked) {
            if (elem.id === "param-drawBHMargin") enableWasmCheckbox.click();
            else bargenBHCheckbox.click();
        }

    }
    else if (elem.type === "text") {

        elem.placeholder = elem.value || "Random";
        sessionStorage.setItem(elem.id, elem.value);

        typedValue = elem.value;
    }
    
    computeWorker.postMessage(["param update", elem.id.slice(6), typedValue, elem.type === "number"]);
    //elem.value = ""; // will be done after receiving confirmation from worker
});
optionsPanel.addEventListener("click", (ev)=>{
    
    if (ev.target.classList.contains("categoryspan")) {
        ev.target.nextElementSibling.classList.toggle("hidden");
        return;
    };
    if (ev.target.id === "button-help") {
        const helpDialog = document.getElementById("help-dialog");
        helpDialog.show();
    }
    
});

// WORKER EVENT HANDLING
computeWorker.addEventListener("message", (ev)=>{

    if (ev.data[0] === "numeric param update success") {
        document.getElementById("param-" + ev.data[1]).value = "";
        return;
    }
    if (ev.data[0] === "timing results") {
        document.getElementById("performanceinfo").innerText = ev.data[1];
    }

});
