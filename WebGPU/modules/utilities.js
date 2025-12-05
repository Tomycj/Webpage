export function boxMesh(vec, indexed = false) {
	const [x,y,z] = [...vec];
    if (!indexed) {
        return new Float32Array([
            -x, -y, -z, // left side upper triangle
            -x,  y,  z,
            -x,  y, -z,
    
            -x, -y, -z, // left side lower triangle
            -x, -y,  z,
            -x,  y,  z,
    
             x,  y, -z, // right side upper triangle
             x,  y,  z,
             x, -y, -z,
    
             x,  y,  z, // right side lower triangle
             x, -y,  z,
             x, -y, -z,
    
            -x, -y, -z, // bottom side near triangle
             x, -y, -z,
             x, -y,  z,
    
            -x, -y, -z, // bottom side far triangle
             x, -y,  z,
            -x, -y,  z,
    
             x,  y,  z, // upper side near triangle
             x,  y, -z,
            -x,  y, -z,
    
            -x,  y,  z, // upper side far triangle
             x,  y,  z,
            -x,  y, -z,
    
             x,  y, -z, // front side lower triangle
             x, -y, -z,
            -x, -y, -z,
    
            -x, -y, -z, // front side upper triangle
            -x,  y, -z,
             x,  y, -z,
    
            -x, -y,  z, // back side lower triangle
             x, -y,  z,
             x,  y,  z,
    
            -x, -y,  z, // back side upper triangle
             x,  y,  z,
            -x,  y,  z
        ])
    } else {
        return [
            new Float32Array([
                 x,  y,  z,  //0
                 x,  y, -z,  //1
                 x, -y, -z,  //2
                 x, -y,  z,  //3
                -x,  y,  z,  //4
                -x,  y, -z,  //5
                -x, -y, -z,  //6
                -x, -y,  z   //7
            ]),
            new Uint16Array([
                3,2,0,0,2,1,  //R
                1,5,4,4,0,1,  //U
                1,2,6,6,5,1,  //B
                7,3,0,0,4,7,  //F
                7,4,5,5,6,7,  //L
                7,6,2,2,3,7   //D
            ])
        ]
    }
}


// Basic:

export function hexString_to_rgba(hexString, alpha) {
		
    hexString = hexString.replace("#",""); // remove possible initial #

    const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
    const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
    const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

    //console.log(`Returned RGBA array [${[red, green, blue, alpha]}] from "#${hexString}" [hexString_to_rgba] `);

    return new Float32Array([red, green, blue, alpha]); // Store the RGB values in an array
}

export function rgba_to_hexString(rgbaArray) {
    const [r, g, b] = rgbaArray;
    const hexR = Math.floor(r * 255).toString(16).padStart(2, '0');
    const hexG = Math.floor(g * 255).toString(16).padStart(2, '0');
    const hexB = Math.floor(b * 255).toString(16).padStart(2, '0');
    return `#${hexR}${hexG}${hexB}`;
}

export function printCMMatrix(matrix,raw = false) { //column major
		
    const formattedMatrix = [];

    if (!raw) {
        for (let col = 0; col < 4; col++) {
            const column = [];
            for (let row = 0; row < 4; row++) {
                column.push(parseFloat(matrix[col + row * 4].toFixed(3)));
            }
            formattedMatrix.push(column);
        }
    } else {
        for (let col = 0; col < 4; col++) {
            const column = [];
            for (let row = 0; row < 4; row++) {
                column.push(matrix[col + row * 4]);
            }
            formattedMatrix.push(column);
        }
    }

    console.table(formattedMatrix);
}

export function importarJson(path="") {
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

export function labelError(error, label="Default error label") {
    const labeledError = new Error (label);
    labeledError.cause = error;
    return labeledError;
}

export	function hasSameStructure(obj1, obj2) { 
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

export function generateHistogram2(data, lim=1, nBins=10) {
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

/** Performs a rolling average of numeric array-like samples (element-wise). */
export class RollingAverages {
    #samples;
    #cursor = 0;
    #rollingSums;
    /** Performs a rolling average of numeric array-like samples (element-wise).
     * @param {Integer} numSamples - Number of samples to average.
     * @param {Integer} sampleLength - Number of elements in each sample array.
     */
    constructor(numSamples, sampleLength) {
        this.#rollingSums = Array(sampleLength).fill(0);
        this.#samples = Array.from({ length: numSamples }, () => Array(sampleLength).fill(0));
    }
    /** Add a new sample to the rolling average.
     * @param {ArrayLike<Number>} arr
     */
    add(arr) {

        if (arr.length !== this.#rollingSums.length) {
            throw new Error("Input array length must match sample length.");
        }

        for (let i = 0; i < this.#rollingSums.length; i++) {
            this.#rollingSums[i] -= this.#samples[this.#cursor][i];
            this.#rollingSums[i] += arr[i];
        }
        this.#samples[this.#cursor] = arr;

        this.#cursor++;
        this.#cursor %= this.#samples.length;
        return this;
    }
    /** A new Array containing the rolling averages. */
    get rollingAverages() {
        return this.#rollingSums.map( x => x/this.#samples.length);
    }
    /** A new Array containing the rolling sums. */
    get rollingSums() {
        return Array.from(this.#rollingSums);
    }
    /** The number of elements in each sample array. */
    get sampleLength() {
        return this.#rollingSums.length;
    }
    /** Logs the current samples to the console. */
    printSamples() {
        for (const sample of this.#samples) {
            console.log(sample.toString());
        }
    }
}


// HTML:

export function switchClass(element, className, state) {
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

export function setAutomaticInputElementWidth (inputElement, min, max, padding) {
    // falla para xxxxe porque allí value = "" -> length = 0

    if (inputElement.validity.badInput) {return;}

    const ancho = Math.max(inputElement.value.length, inputElement.placeholder.length);
    inputElement.style.width = `${ Math.min(Math.max(ancho, min) + padding, max) }ch`;
}

export function playSound(soundElement, avoidSpam=true) { 
    if ((avoidSpam && soundElement.currentTime > 0.05) || !avoidSpam) {
        soundElement.currentTime = 0; 
    }
    soundElement.play(); 
}