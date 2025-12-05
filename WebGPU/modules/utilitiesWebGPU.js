import { RollingAverages} from "utilities"

export async function readBuffer(device, buffer) {
    const gpuReadBuffer = device.createBuffer({size: buffer.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, buffer.size);
    device.queue.submit([copyEncoder.finish()]);
    await gpuReadBuffer.mapAsync(GPUMapMode.READ);
    return gpuReadBuffer.getMappedRange();
}

/** A WebGPU timing helper object. */
export 	class WGPUTimer {
    #nDeltas;
    #capacity;
    #gpuTiming; get gpuTiming() {return this.#gpuTiming;}
    #labels;
    #querySet;
    #resolveBuffer;
    #resultBuffer;
    #nonGpuTimes;
    #samples;
    #BYTES_PER_QUERY = 8;
    /** A WebGPU timing helper object.
     * @param {GPUDevice} device - The GPUDevice.
     * @param {Boolean} gpuTiming - True if timestamp-query is enabled. Otherwise only use jsTimestamp().
     * @param {Integer} deltasToRecord - The number of time intervals to calculate and display.
     * @param {Integer} numSamples - The displayed result will be a rolling average of this many samples.
     */
    constructor(device, gpuTiming, deltasToRecord, numSamples = 30) {
        
        this.#gpuTiming = gpuTiming;
        this.#nDeltas = deltasToRecord;
        this.#labels = Array(deltasToRecord).fill("DeltaT"); this.#labels.push("Total");
        this.#capacity = gpuTiming ? deltasToRecord * 2 : deltasToRecord + 1;
        this.#samples = new RollingAverages(numSamples, deltasToRecord);

        if (gpuTiming) {
            this.#querySet = device.createQuerySet({
                label: "Query set for WGPUTimer",
                type: "timestamp",
                count: this.#capacity,
            });
            this.#resolveBuffer = device.createBuffer({
                label: "Query resolve buffer for WGPUTimer",
                size: this.#BYTES_PER_QUERY * this.#capacity,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.#resultBuffer = device.createBuffer({
                label: "Results buffer for WGPUTimer",
                size: this.#BYTES_PER_QUERY * this.#capacity,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
        else {
            this.#nonGpuTimes = new Float32Array(this.#capacity);
        }
    }
    /** To be provided to a GPURenderPassDescriptor.
     * 
     * @param {GPUSize32} beginningOfPassWriteIndex 
     * @param {GPUSize32} endOfPassWriteIndex 
     * @returns {GPURenderPassTimestampWrites}
     */
    generateTimestampWrites(beginningOfPassWriteIndex, endOfPassWriteIndex) {
        if (!this.#gpuTiming) {
            console.warn("GPU Timing is disabled. Nothing was generated.");
            return undefined;
        }
        if (endOfPassWriteIndex >= this.#querySet.count) {
            throw new RangeError(`endOfPassWriteIndex must be lower than the internal querySet.count: ${this.#querySet.count}`);
        }
        return {
            querySet: this.#querySet,
            beginningOfPassWriteIndex,
            endOfPassWriteIndex,
        }
    }
    /** Stores a timestamp with performance.now().
     * Timing alternative intended as a manual fallback if gpuTiming is false.
     * Displayed results will be the time intervals between the timestamps.
     * 
     * @param {Integer} index - The timestamp index to record to. Should not be higher than the amount required to calculate all intervals.
     */
    jsTimestamp(index) {
        if (!this.#gpuTiming) {
            if (index >= this.#capacity) {
                console.warn(`Discarded timestamp index ${index} >= ${this.#capacity}.`);
                return;
            }
            this.#nonGpuTimes[index] = window.performance.now();
            return;
        }
    }
    /** Must be called right before encoder.finish().
     *
     * @param {GPUCommandEncoder} encoder 
     */
    gpuResolveTimestampQueries(encoder) {
        if (this.#gpuTiming) {
            // Put the result of the timing queries in the resolve buffer
            encoder.resolveQuerySet(this.#querySet, 0, this.#querySet.count, this.#resolveBuffer, 0);
            // Copy from resolve buffer to result buffer
            if (this.#resultBuffer.mapState === "unmapped") {
                encoder.copyBufferToBuffer(this.#resolveBuffer, 0, this.#resultBuffer, 0, this.#resultBuffer.size);
            }
        }
    }
    //TODO: Not even sure if it's possible to get multiple timestamps per pass
    /** Stores 1 query at the given index
     *
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUSize32} queryIndex 
     */
    gpuWriteTimestamp(encoder, queryIndex) {
        if (this.#gpuTiming) {
            // Put the result of the timing queries in the resolve buffer
            encoder.resolveQuerySet(this.#querySet, queryIndex, 1, this.#resolveBuffer, queryIndex * this.#BYTES_PER_QUERY);
        }
    }
    /** Copies all stored queries to the result buffer
     *
     * @param {GPUCommandEncoder} encoder 
     */
    gpuCopyAllTimestamps(encoder) {
        if (this.#gpuTiming) {
            // Copy from resolve buffer to result buffer
            if (this.#resultBuffer.mapState === "unmapped") {
                encoder.copyBufferToBuffer(this.#resolveBuffer, 0, this.#resultBuffer, 0, this.#resultBuffer.size);
            }
        }
    }
    /** Reads and displays the timestamps.
     * 
     * @param {HTMLElement} htmlElement - Its innerText will be overwritten with the timing results.
     */
    async getAndDisplayResults(htmlElement) {
        const dt = new Float64Array(this.#nDeltas);
        let text = "";
        if (this.#gpuTiming && this.#resultBuffer.mapState === "unmapped") {

            await this.#resultBuffer.mapAsync(GPUMapMode.READ);
            const timesNanoseconds = new BigInt64Array(this.#resultBuffer.getMappedRange());

            for (let i = 0, j = 0; i < dt.length; i++, j+=2) {
                dt[i] = Number(timesNanoseconds[j+1] - timesNanoseconds[j]) / 1_000_000;
            }
            this.#resultBuffer.unmap();
        }
        else if (!this.#gpuTiming) {
            const t = this.#nonGpuTimes;
            for (let i = 0; i < dt.length; i++) {
                dt[i] = (t[i+1] - t[i]);
            }
            text +="⚠ GPU Timing desact.\n";
        }
        else { return; }

        const avgs = this.#samples.add(dt).rollingAverages;
        const labels = this.#labels;

        avgs.forEach((avg, i) => text += `${labels[i]}: ${avg.toFixed(3)} ms\n`);

        text += `${labels[this.#nDeltas]}: ${avgs.reduce((a, v) => a + v).toFixed(3)} ms`;

        htmlElement.innerText = text;
    }
    /** Set the label to be displayed for each result. 
     * 
     * @param {Array<String>} labels - Of length >= cantDeltas. Element [cantDeltas] defaults to "Total". 
    */
    setLabels(labels) {
        const N = this.#nDeltas;

        if (labels.length < N) {
            throw new RangeError("Labels array must be of length >= cantDeltas.");
        }
        for (let i = 0; i < N; i++) { this.#labels[i] = labels[i]; }

        this.#labels[N] = labels[N] ?? "Total";
    }
    /** The number of time intervals calculated. */
    get cantDeltas() {
        return this.#nDeltas;
    }
}