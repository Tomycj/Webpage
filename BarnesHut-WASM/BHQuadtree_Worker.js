import Alea from "./modules/aleaRng.js";
import { RollingAverages } from "./modules/utilities.js";
import { barnesHutWasm } from "./modules/wasmInterface.js";
import { FrameLoopController_Worker } from "./modules/WebWorkerUtils.js";

const HASH_FREEZE_FRAME = null;
const PERFORMANCE_LOG_PERIOD = 15;

const DIMENSIONS = 2;
const DIMS_FAC = 1 / DIMENSIONS;


addEventListener("message", (ev)=> {
    
    if (ev.data[0] !== "initialize") return;
    
    const ctx = ev.data[1].getContext("2d");
    const params = ev.data[2];

    main(ctx, params);

});


async function main(ctx, params) {
    const avgs = new RollingAverages(10, 3);

    let {pointInds, points, pMasses, vels, colBorders, sqBBox} = await barnesHutWasm.initialize(300, 16, params, DIMENSIONS);

    function setPointsMemory() {

        const rng = params.seed === "" ? Alea() : Alea(params.seed);

        const {N, outliers, vmax, vmaxOutliers} = params;
        const vScaleFac = vmaxOutliers / vmax;

        const outliersAmount = Math.floor(N*outliers/100);

        for (let i = 0, pInd = 0; i < N; i++, pInd += DIMENSIONS) {

            points[pInd]     = rng()*600;
            points[pInd + 1] = rng()*600;

            pMasses[i] = rng()*10 + 1;

            vels[pInd] = (rng()-0.5) * vmax;
            vels[pInd+1] = (rng()-0.5) * vmax;
            
            pointInds[i] = pInd;
        }
        for (let i = 0; i < outliersAmount; i++) {
            pMasses[i] = Math.abs(rng.normal(150, 100)) + 0.01;
            vels[i*2] *= vScaleFac;
            vels[i*2+1] *= vScaleFac;
        }

        colBorders.set([0, 0, ctx.canvas.width, ctx.canvas.height]);
        sqBBox.fill(0);
    }
    setPointsMemory();

    // Tree
    const tree = {
        CHILDREN_PER_NODE: 2**DIMENSIONS,
        BYTES_PER_CHILD: 4,
        BYTES_PER_NODE: 16, // CHILDREN_PER_NODE * BYTES_PER_CHILD
        bounds: [],
        nodes: [],
        nodePointsBegin: [],
        coms: [],
        get rootWidth() {return this.bounds[2] - this.bounds[0]},
        maxDepth: null,

        stagedBounds: null,

        reset() {
            this.nodes = [];
            this.nodePointsBegin = [];
            this.coms = [];
            this.bounds = [];
            this.maxDepth = null;
        },
        draw(ctx, drawLeaves = true, drawRoot = true, drawLeaveInds = true) {

            ctx.reset();
            ctx.strokeStyle = "#252525ff";
            ctx.fillStyle = "white";
            const h = ctx.canvas.height;

            function drawPoints(fillStyle = "Chartreuse") {

                ctx.fillStyle = fillStyle;

                for (let i = 0, pInd = 0; i < pMasses.length; i++, pInd += DIMENSIONS) {

                    const x = points[pInd];
                    const y = points[pInd + 1];
                    const m = pMasses[i];

                    ctx.beginPath();
                    ctx.arc(x, h-y, Math.max(2, Math.sqrt(m)), 0, Math.PI*2);
                    ctx.fill();
                }
            }

            function traverse(nodeInd, bounds) {
                if (nodeInd === null) return; // I came from tree.nodes[null], because node[chInd] can be null.

                const node = tree.nodes[nodeInd];

                if (tree.isLeaf(node)) {
                
                    ctx.strokeRect(bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]);
                    
                    if (drawLeaveInds) {
                        ctx.fillText(nodeInd, bounds[0] + 2, bounds[1] - 2);
                    }
                    
                    return;
                } else {
                
                    const [LL, LR, UL, UR] = getQuadrants(bounds);

                    traverse(node[0], LL);
                    traverse(node[1], LR);
                    traverse(node[2], UL);
                    traverse(node[3], UR);
                }

            }

            const trb = [this.bounds[0], h - this.bounds[1], this.bounds[2], h - this.bounds[3]]; // transformed root bounds

            if (drawLeaves) traverse(0, trb);
            
            if (drawRoot) ctx.strokeRect(trb[0], trb[1], trb[2] - trb[0], trb[3] - trb[1]);

            drawPoints("Chartreuse");

        },
        drawNode(ctx, bounds, color = "white") {
            ctx.strokeStyle = color;
            // transform to canvas coordinates
            ctx.strokeRect(bounds[0], ctx.canvas.height - bounds[1], bounds[2] - bounds[0], bounds[1] - bounds[3]);
        },
        drawCoM(ctx, nodeInd, color = "yellow", radius = 10, widthForBHTreshold, targetParticleInfo) {
            ctx.strokeStyle = color;
            
            let x = tree.coms[nodeInd*3];
            let y = tree.coms[nodeInd*3 + 1];

            const h = ctx.canvas.height
            y = h - y;


            const rSin45 = 0.7071067811865475 * radius;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2*Math.PI);
            if (widthForBHTreshold) {
                const r = widthForBHTreshold / params.theta;
                if (targetParticleInfo) {

                    let [xx, yy, d] = targetParticleInfo;
                    yy = h - yy;
                    const fac = (d-r) / d;

                    ctx.moveTo(x,y);
                    ctx.lineTo( (x-xx)*fac + xx, (y-yy)*fac + yy);

                } else {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, 2*Math.PI);
                }
            }

            ctx.moveTo(x + rSin45, y + rSin45);
            ctx.lineTo(x - rSin45, y - rSin45);
            ctx.moveTo(x + rSin45, y - rSin45);
            ctx.lineTo(x - rSin45, y + rSin45);
            
            ctx.stroke();

        },
        computeRectBounds(points) {
            let xmin = Infinity;
            let ymin = Infinity;
            let xmax = -Infinity;
            let ymax = -Infinity;

            for (let i = 0; i < params.N*DIMENSIONS; i+=DIMENSIONS) {

                const x = points[i];
                const y = points[i+1];

                xmin = Math.min(xmin, x);
                ymin = Math.min(ymin, y);
                xmax = Math.max(xmax, x);
                ymax = Math.max(ymax, y);

            }
            return [xmin, ymin, xmax, ymax];
        },
        stageSquareBounds(rectBounds) {

            const [xmin, ymin, xmax, ymax] = rectBounds;

            const widthX = xmax - xmin;
            const widthY = ymax - ymin;
            const halfSide = Math.max(widthX, widthY) / 2;

            const cx = (xmin + xmax) / 2;
            const cy = (ymin + ymax) / 2;

            this.stagedBounds = [cx - halfSide, cy - halfSide, cx + halfSide, cy + halfSide];
        },
        stageSquareBoundsWasm() {
            this.stagedBounds = Array.from(sqBBox);
        },
        build() {
            this.reset();

            if (this.stagedBounds === null) {
                this.stageSquareBounds(this.computeRectBounds(points));
            }
            
            this.bounds = this.stagedBounds;
            buildTree(this.bounds, 0, pointInds.length, params.maxTreeDepth);
            this.nodePointsBegin.push(pointInds.length);
            this.stagedBounds = null;
            this.maxDepth = params.maxTreeDepth;
        },
        isLeaf(node) {
            return node.length === 0;
        },
    }

    const loopControllerWorker = new FrameLoopController_Worker(null, frame, null);


    function buildTree(bounds, begin, end, depthLimit) {

        if (begin === end) return null;

        const result = tree.nodes.length;

        tree.nodes.push([]);

        tree.nodePointsBegin[result] = begin;

        const pInd = pointInds[begin];
        const firstX = points[pInd];
        const firstY = points[pInd+1];
        const comInd = result * (DIMENSIONS + 1);

        // Check if node is leaf
        if (begin + 1 === end) { // is single point

            const mass = pMasses[pInd * DIMS_FAC]; // have to use division because points aren't grouped in arrays or because data is not serialized xym

            tree.coms[comInd  ] = firstX;
            tree.coms[comInd+1] = firstY
            tree.coms[comInd+2] = mass;

            return result;
        };

        // Check if all points are equal or if depth limit reached (to stop infinite subdivision)
        let allEqual = true;

        for (let i = begin + 1; i < end; i++) {
            const ind = pointInds[i]
            if (points[ind] !== firstX || points[ind+1] !== firstY) {
                allEqual = false;
                break;
            }
        }

        if (allEqual || depthLimit === 0) {
            let mass = pMasses[pInd * DIMS_FAC];
            let mx = firstX * mass;
            let my = firstY * mass;
            
            for (let i = begin + 1; i < end; i++) {
                const ind = pointInds[i];
                const m = pMasses[ind * DIMS_FAC];

                mass += m;
                mx += points[ind  ] * m;
                my += points[ind+1] * m;
            }

            const fac = 1 / mass;
            tree.coms[comInd  ] = mx * fac;
            tree.coms[comInd+1] = my * fac;
            tree.coms[comInd+2] = mass;
            return result;
        }


        // otherwise is internal

        const center = getCenter(bounds);

        const split_y = bottom(begin, end, center[1]);
        
        const split_x_lower = left(begin, split_y, center[0]);

        const split_x_upper = left(split_y, end, center[0]);


        const children = tree.nodes[result] = [null, null, null, null];

        depthLimit--;

        children[0] = buildTree([bounds[0], bounds[1], center[0], center[1]], begin, split_x_lower, depthLimit);
        children[1] = buildTree([center[0], bounds[1], bounds[2], center[1]], split_x_lower, split_y, depthLimit);
        children[2] = buildTree([bounds[0], center[1], center[0], bounds[3]], split_y, split_x_upper, depthLimit);
        children[3] = buildTree([center[0], center[1], bounds[2], bounds[3]], split_x_upper, end, depthLimit);

        
        let totalMass = 0;
        let comX = 0, comY = 0;
        let childMass = 0;

        for (let i = 0; i < 4; i++) {
            const childInd = children[i];
            if (childInd !== null) {
                const childComInd = childInd * (DIMENSIONS + 1);

                childMass = tree.coms[childComInd+2]
                comX += tree.coms[childComInd  ] * childMass;
                comY += tree.coms[childComInd+1] * childMass;
                totalMass += childMass;
            }
        }
        
        const fac = 1 / totalMass;
        tree.coms[comInd  ] = comX * fac;
        tree.coms[comInd+1] = comY * fac;
        tree.coms[comInd+2] = totalMass;
        
        return result;
    }

    function bottom(first, last, centerY) {
        
        let tmp = 0;

        while (first != last) {
            while (points[pointInds[first]+1] < centerY) {
                ++first;
                if (first === last) {
                    return first;
                }
            }
            do {
                --last;
                if (first === last) return first;

            } while (!(points[pointInds[last]+1] < centerY)) {

                tmp = pointInds[first];

                pointInds[first] = pointInds[last];
                pointInds[last] = tmp;
                ++first;
            }
        }
        return first;
    }

    function left(first, last, centerX) {
        
        let tmp = 0;

        while (first != last) {
            while (points[pointInds[first]] < centerX) {
                ++first;
                if (first === last) return first;
            }
            do {
                --last;
                if (first === last) return first;

            } while (!(points[pointInds[last]] < centerX)) {

                tmp = pointInds[first];

                pointInds[first] = pointInds[last];
                pointInds[last] = tmp;

                ++first;
            }
        }
        return first;
    }

    // Simulation
    function frame() {

        const {dt, stepsPerFrame: iterations, enableWasm} = params;

        const t0 = performance.now();
        tree.build();
        const t1 = performance.now();
        tree.draw(ctx, params.drawLeaves, params.drawRoot, false);
        const t2 = performance.now();
        
        drawFrameStats(ctx,
            params.drawFrameNumber ? loopControllerWorker.frame + 1 : false,
            params.drawFps ? loopControllerWorker.fps : false,
        );

        if (enableWasm) {
            barnesHutWasm.processNewFrame(tree, dt, iterations);
            tree.stageSquareBoundsWasm();
        } else {
            for (let i = 0; i < iterations; i++) { advanceTimeJs() }
        }
        const t3 = performance.now();

        avgs.add([t1-t0, t2-t1, t3-t2]);
        if (loopControllerWorker.frame % PERFORMANCE_LOG_PERIOD == 0) sendTimingResults(avgs);
        if (loopControllerWorker.frame === HASH_FREEZE_FRAME) checkHash(points, true);
    }

    function advanceTimeJs() {

        const {N, dt, g, epsilon, theta} = params;
        // points, pointInds, vels, colBorders, pMasses
        // tree: rootWidth, nodes, nodePointsBegin, coms


        // accumulate accelerations (force/m)

        for (let pInd = 0, ax = 0, ay = 0; pInd < N*DIMENSIONS; pInd += DIMENSIONS, ax = ay = 0) {

            const x = points[pInd];
            const y = points[pInd + 1];

            // Barnes-Hut approach
            /* Defining the function inside the loop resulted more efficient than defining it outside
            */

            function traverseBH(nodeInd, width) {

                if (nodeInd === null) return;
                const currentNode = tree.nodes[nodeInd];
                
                if (tree.isLeaf(currentNode)) {

                    const start = tree.nodePointsBegin[nodeInd];
                    const end = tree.nodePointsBegin[nodeInd+1];

                    for (let k = start; k < end; k++) {

                        const j = pointInds[k];
                        
                        const dx = points[j  ] - x;
                        const dy = points[j+1] - y;

                        let d = dx*dx + dy*dy + epsilon;
                        d = d * Math.sqrt(d);

                        const fac = g * pMasses[j * DIMS_FAC] / d;

                        ax += fac * dx;
                        ay += fac * dy;
                    }
                    return;
                }

                // is parent. Is far enough?

                const comInd = nodeInd * (DIMENSIONS + 1);
                const dx = tree.coms[comInd  ] - x;
                const dy = tree.coms[comInd+1] - y;
                const dsq = dx * dx + dy * dy + epsilon;
                const d = Math.sqrt(dsq);

                if (width / d < theta) {

                    const m = tree.coms[comInd+2];

                    const fac = g * m / (d * dsq);

                    ax += fac * dx;
                    ay += fac * dy;

                    return;
                }

                // is a close parent. needs subdivision.

                width = width / 2;

                traverseBH(currentNode[0], width); //in wat: check that index is not zero.
                traverseBH(currentNode[1], width);
                traverseBH(currentNode[2], width);
                traverseBH(currentNode[3], width);

            }

            function traverseBHWithBounds(nodeInd, bounds) {

                if (nodeInd === null) return;
                const currentNode = tree.nodes[nodeInd];
                
                if (tree.isLeaf(currentNode)) {

                    const start = tree.nodePointsBegin[nodeInd];
                    const end = tree.nodePointsBegin[nodeInd+1];

                    for (let k = start; k < end; k++) {

                        const j = pointInds[k];
                        
                        const dx = points[j  ] - x;
                        const dy = points[j+1] - y;

                        let d = dx*dx + dy*dy + epsilon;
                        d = d * Math.sqrt(d);

                        const fac = g * pMasses[j * DIMS_FAC] / d;

                        ax += fac * dx;
                        ay += fac * dy;
                    }
                    return;
                }

                // is parent. Is far enough?

                const comInd = nodeInd * (DIMENSIONS + 1);
                const dx = tree.coms[comInd  ] - x;
                const dy = tree.coms[comInd+1] - y;
                const dsq = dx*dx + dy*dy + epsilon;
                const d = Math.sqrt(dsq);

                const width = bounds[2]-bounds[0];

                if (width / d < theta) {

                    if (pInd === 0) {

                        tree.drawNode(ctx, bounds,"red")
                        tree.drawCoM(ctx, nodeInd, "red", 5, width, [x, y, d]);
                    }


                    const m = tree.coms[comInd+2];

                    const fac = g * m / (d * dsq);

                    ax += fac * dx;
                    ay += fac * dy;

                    return;
                }

                // is a close parent. needs subdivision.

                const [LL, LR, UL, UR] = getQuadrants(bounds);

                traverseBHWithBounds(currentNode[0], LL); //in wat: check that index is not zero.
                traverseBHWithBounds(currentNode[1], LR);
                traverseBHWithBounds(currentNode[2], UL);
                traverseBHWithBounds(currentNode[3], UR);

            }
            
            //traverseBH(0, tree.rootWidth);
            if (params.drawBHMargin && pInd === 0) traverseBHWithBounds(0, tree.bounds);
            else traverseBH(0, tree.rootWidth);

            vels[pInd  ] += ax * dt;
            vels[pInd+1] += ay * dt;

        }
        // update velocities and positions, also get new bounds;
        
        let xmin = Infinity;
        let ymin = Infinity;
        let xmax = -Infinity;
        let ymax = -Infinity;

        for (let i = 0; i < points.length; i += DIMENSIONS) {

            let x = points[i  ] += vels[i  ] * dt;
            let y = points[i+1] += vels[i+1] * dt;

            // collision

            if (x < colBorders[0]) {
                x = points[i] = colBorders[0];
                vels[i] = 0;
            }
            else if (x > colBorders[2]) {
                x = points[i] = colBorders[2];
                vels[i] = 0;
            }

            if (y < colBorders[1]) {
                y = points[i+1] = colBorders[1];
                vels[i+1] = 0;
            }
            else if (y > colBorders[3]) {
                y = points[i+1] = colBorders[3];
                vels[i+1] = 0;
            }

            // bounds computation
            xmin = Math.min(xmin, x);
            ymin = Math.min(ymin, y);
            xmax = Math.max(xmax, x);
            ymax = Math.max(ymax, y);

        }

        const rectBounds = [xmin, ymin, xmax, ymax];

        tree.stageSquareBounds(rectBounds);
    }

    // Messaging
    addEventListener("message", (ev)=>{

        if (ev.data[0] === "reset") {
            setPointsMemory();
            tree.stagedBounds = null;
            loopControllerWorker.setFrameZero();
            return;
        }

        if (ev.data[0] !== "param update") return;

        const paramName = ev.data[1];
        const newValue = ev.data[2];
        params[paramName] = newValue;
        barnesHutWasm.updateGlobalIfPresent(paramName, newValue);

        if (paramName === "N") {
            ({pointInds, points, pMasses, vels, colBorders, sqBBox} = barnesHutWasm.remapPointsMemory(params.N, DIMENSIONS));
            setPointsMemory();
            tree.stagedBounds = null;
        }
        else if (paramName === "maxTreeDepth" && loopControllerWorker.paused) {
            tree.build();
            tree.draw(ctx, params.drawLeaves, params.drawRoot, false);
            drawFrameStats(ctx,
                params.drawFrameNumber ? loopControllerWorker.frame + 1 : false,
                params.drawFps ? loopControllerWorker.fps : false,
            );
        }
        
        if (ev.data[3]) postMessage(["numeric param update success", paramName]);

    });

}


// bounds = [xmin, ymin, xmax, ymax]
function getCenter(bounds) {
    return [
        (bounds[0] + bounds[2]) / 2,
        (bounds[1] + bounds[3]) / 2,
    ]
}

function getQuadrants(bounds) {

    const [xmin, ymin, xmax, ymax] = bounds;

    const [cx, cy] = getCenter(bounds);

    return [
        [xmin, ymin, cx, cy],
        [cx, ymin, xmax, cy],
        [xmin, cy, cx, ymax],
        [cx, cy, xmax, ymax]
    ]
}

function sendTimingResults(rollingAverage) {
    const vals = rollingAverage.rollingAverages;
    const text = 
        `Tree: ${vals[0].toFixed(1)} ms\n` +
        `Draw: ${vals[1].toFixed(1)} ms\n` + 
        `Compute: ${vals[2].toFixed(1)} ms`;

    postMessage(["timing results", text]);
}

function drawFrameStats(ctx, frame, fps) {

    ctx.fillStyle = "white";
    
    const textWidth = 40 + 9.6 * (""+Number(frame )).length; // "Edad: " + n frame digits

    const x = ctx.canvas.width - Math.max(75, textWidth + 5);
    const y = ctx.canvas.height - 5;

    if (frame !== false) {
        ctx.font = "16px Calibri"
        ctx.fillText("Edad:", x, y);
        ctx.font = "16px Courier New"
        ctx.fillText(frame, x + 40, y);
    }
    if (fps !== false) {
        ctx.font = "16px Calibri"
        ctx.fillText("FPS:", x, y - 18);
        ctx.font = "16px Courier New"
        ctx.fillText(fps, x + 40, y - 18);
    }

}

function checkHash(arr, stop = true) {
    const hash = arr[0];
    if (stop) throw new Error("STOPPED BY HASH " + hash);
    else console.log("HASH:", hash);
    
}