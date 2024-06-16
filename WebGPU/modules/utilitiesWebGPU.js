import { RollingAverages} from "utilities"

export 	class Timer {
    #deltasToRecord;
    #capacity;
    #gpuTiming;
    #querySet;
    #resolveBuffer;
    #resultBuffer;
    #state = "";
    #nonGpuTimes;
    #samples;

    constructor(device, gpuTiming, deltasToRecord, numSamples = 30) {
        this.#gpuTiming = gpuTiming;
        this.#deltasToRecord = deltasToRecord;
        this.#capacity = gpuTiming ? deltasToRecord * 2 : deltasToRecord + 1;
        this.#samples = new RollingAverages(numSamples, deltasToRecord);

        if (gpuTiming) {
            this.#querySet = device.createQuerySet({
                type: "timestamp",
                count: this.#capacity,
            });
            this.#resolveBuffer = device.createBuffer({
                size: 8 * this.#capacity,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.#resultBuffer = device.createBuffer({
                size: 8 * this.#capacity,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
        else {
            this.#nonGpuTimes = new Float32Array(this.#capacity);
        }
    }
    generateTimestampWrites(beginningOfPassWriteIndex, endOfPassWriteIndex) {
        if (!this.#gpuTiming) {
            console.warn("GPU Timing is disabled, no available querySet.");
            return undefined;
        }
        if (endOfPassWriteIndex >= this.#querySet.count) {
            throw new Error("endOfPassWriteIndex must be lower than querySet.count.");
        }
        return {
            querySet: this.#querySet,
            beginningOfPassWriteIndex,
            endOfPassWriteIndex,
        }
    }
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
    async getAndDisplayResults(htmlElement) {
        const dt = new Float64Array(this.#deltasToRecord);
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
        } else {
            return;
        }

        this.#samples.add(dt);
        const avgs = this.#samples.averages;

        text += `Draw: ${/*dt[0]*/avgs[0].toFixed(3)} ms\
        \nCompute: ${/*dt[1]*/avgs[1].toFixed(3)} ms`;

        if (dt.reduce((a, v) => a + v, 0) > 30) {
            text += "\nGPU: Brrrrrrrrrrr";
        }
        htmlElement.innerText = text;
    }

}