
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

/** Compute the standard deviation.
 * @param {ArrayIterable.<number>} values 
 */
export function stdev(values) {
    let sum = 0;
    for (const i of values) sum += i;
    const mean = sum / values.length;
    sum = 0;
    for (const i of values) sum += (i-mean)*(i-mean);
    return Math.sqrt(sum / values.length);
}