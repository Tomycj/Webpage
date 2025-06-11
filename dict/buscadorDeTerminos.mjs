import Fuse from "./fuse.basic.min.mjs";

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./serviceWorker.mjs");
} else {
    displayInfo("⚠ Service worker no disponible, es posible que la página no funcione.");
}


let fullList = [
    ["Example entry", "Entrada de ejemplo", "Si tiene anotaciones, aparecerán aquí. No son buscadas.", 0, null,
        "Example entry Entrada de ejemplo"
    ],
    ["Para comenzar", "importe datos (json) o añada entradas manualmente", "", 0, null, "Para comenzar importe datos json o añada entradas manualmente"],
    ["Formato del json", "array de subarrays con formato:", "[eng, esp, notas, índice de categoría], siendo el primer subarray" + 
        " una lista de los nombres de las categorías: [\"categoría\", \"ejemplo\"]", 1, null,
        "Formato del json array de subarrays con formato:"
    ],
    ["Algunos caracteres son", "ignorados por la búsqueda:", "( ) = / ...", 0, null,
        "Algunos caracteres son ignorados por la búsqueda:"
    ],
]
let idToCategory = ["categoría","ejemplo"];
let usingDemoValues = true;

const fuseOptions = {
    keys: ["5"], // must match formatImportedEntries// [{name: "searchabale fields", getFn: (item) => [item[0], item[1]]}],
    ignoreDiacritics: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
}

const fuse = new Fuse(fullList, fuseOptions);


const search = document.getElementById("search");


const database = await (async ()=>{

    const OBJ_STORE_NAME = "translations";

    const errorHandler = (ev)=> {
        console.error(ev.target.error)
    }

    // create database if doesn't exit
    function createDB() {
        return new Promise((resolve, reject)=>{
            const openRq = window.indexedDB.open("translations-database");
            let hasRequiredUpgrade = false;

            openRq.onerror = (ev)=> {
                errorHandler(ev);
                reject();
            }

            openRq.onupgradeneeded = (ev)=> {
                console.log("Upgrading/creating database...");

                const db = ev.target.result;
                const options = {autoIncrement: true}

                db.createObjectStore(OBJ_STORE_NAME, options);

                const upgradeTransaction = ev.target.transaction;

                upgradeTransaction.oncomplete = ()=> {
                    console.log("Done upgrading/creating.");
                    hasRequiredUpgrade = true;
                }
            }

            openRq.onsuccess = (ev)=> {
                console.log("Returning database...");
                const db = ev.target.result;    
                resolve([db, hasRequiredUpgrade]);
            }
        })
    }

    const [db, hasBeenUpdated] = await createDB();

    function storeBulk(entries, retrieveKeys = false) {

        console.log("Storing multiple entries...");

        return new Promise((resolve, reject)=> {

            const transaction = db.transaction(OBJ_STORE_NAME, "readwrite");

            transaction.onerror = (ev)=> {
                console.log("  Storing transaction error!:", ev.target.error);
                reject(ev.target.error);
            }

            const entriesStore = transaction.objectStore(OBJ_STORE_NAME);

            let keys = new Array(entries.length);

            if (retrieveKeys) {

                entries.forEach((entry, i)=>{
                    if (!entry) console.warn("  Storing empty entry");
                    const addRequest = entriesStore.add(entry);
                    addRequest.onsuccess = (key)=>{keys[i] = key}
                });

            } else {
                entries.forEach(entry=>{
                    entriesStore.add(entry);
                });
            }

            transaction.oncomplete = ()=> {
                console.log("  Storing transaction completed!");
                resolve(keys);
            };
        });
    }

    function storeSingle(entry, updateCategories = false) {
        console.log(`Storing entry${updateCategories ? " with new category" : ""}...`);

        return new Promise((resolve, reject)=>{
            const transaction = db.transaction(OBJ_STORE_NAME, "readwrite");

            transaction.onerror = (ev)=> {
                console.log("  Storing transaction error!:", ev.target.error);
                reject(ev.target.error);
            }

            const entriesStore = transaction.objectStore(OBJ_STORE_NAME);

            let key;

            if (!updateCategories) {
                entriesStore.add(entry).onsuccess = (res)=>{key = res};
            } else {
                entriesStore.openCursor().onsuccess = (ev)=>{
                    const cursor = ev.target.result;

                    if (cursor === null) {
                        entriesStore.add(idToCategory);
                    } else {
                        cursor.update(idToCategory);
                    }
                    entriesStore.add(entry).onsuccess = (res)=>{key = res};
                }
            }

            transaction.oncomplete = ()=> {
                console.log("  Storing transaction completed!");
                resolve(key);
            };


        })

    }


    function retrieveAll(withKeys = false) {
        return new Promise((resolve, reject)=> {

            const transaction = db.transaction(OBJ_STORE_NAME);
            const entriesStore = transaction.objectStore(OBJ_STORE_NAME);

            if (withKeys) {
                const entries = [];
                const cursorRequest = entriesStore.openCursor();
                cursorRequest.onsuccess = _=> {
                    const cursor = cursorRequest.result;
                    if (cursor) {
                        entries.push([...cursor.value, cursor.key]);
                        cursor.continue();
                    } else {
                        resolve(entries);
                    }
                }
            } else {
                const getEntriesRequest = entriesStore.getAll();
                getEntriesRequest.onerror = (ev)=> {
                    errorHandler(ev);
                    reject();
                };
                getEntriesRequest.onsuccess = _=> {
                    resolve(getEntriesRequest.result);
                }
            }
        });
    }

    function clear() {
        return new Promise((resolve, reject)=>{
            const clearTransaction = db.transaction(OBJ_STORE_NAME, "readwrite");
            const clearRequest = clearTransaction.objectStore(OBJ_STORE_NAME).clear();
    
            clearTransaction.oncomplete = ()=>{
                console.log(`Database cleared: ${OBJ_STORE_NAME}`);
                resolve();
            }
            clearTransaction.onerror = (err)=>{
                console.error("Error clearing entries on database:", err);
                reject(err);
            }
        });
    }

    function remove(key) {
        const deleteTransaction = db.transaction(OBJ_STORE_NAME, "readwrite");
        const deleteRequest = deleteTransaction.objectStore(OBJ_STORE_NAME).delete(key);

        deleteTransaction.oncomplete = ()=>{
            console.log("Entry removed.");
        }
        deleteTransaction.onerror = (err)=>{
            console.error("Error removing entry from db:", err);
        }
    }

    return {
        db,
        retrieveAll,
        storeBulk,
        storeSingle,
        clear,
        remove,
    }
})();


const addTermMenu = (()=>{
    
    const menu = document.getElementById("add-term-menu");

    const engInput = document.getElementById("add-term-eng");
    const espInput = document.getElementById("add-term-esp");
    const categInput = document.getElementById("add-term-categ");
    const notesInput = document.getElementById("add-term-notes");
    
    const addButton = document.getElementById("add-term");
    const returnButton = document.getElementById("add-term-return");


    function clearInputs() {
        engInput.value = "";
        espInput.value = "";
        categInput.value = "";
        notesInput.value = "";
        addButton.disabled = true;
    }

    function updateAddButton() {
        if (engInput.value !== "" && espInput.value !== "") {
            addButton.disabled = false;
        } else {
            addButton.disabled = true;
        }
    }

    document.getElementById("required-entries").addEventListener("input", updateAddButton);

    
    addButton.addEventListener("click", addTermHandler);

    returnButton.addEventListener("click", hide);

    function focusNextInput(currentElem) {

        const tabIndex = currentElem.tabIndex;
        const next = document.body.querySelector(
            `[tabindex='${tabIndex+1}']`,
        );
        next.focus();    
    }
    function unHide() {

        search.hidden = true;
    
        translationsGrid.hide();
    
        menu.hidden = false;
        engInput.value = search.value;

    }
    function hide() {

        search.hidden = false;
        
        translationsGrid.unHide();
    
        document.getElementById("add-term-menu").hidden = true;
        
        search.value = "";
        search.dispatchEvent(new Event("input"));
    }
    function addTermHandler() {
        
        const engTerm = engInput.value;
        const espTerm = espInput.value;
        const categ = categInput.value || categInput.placeholder;
        const notes = notesInput.value;

        //const outcomeDisplay = addVtoReturnButton.parentElement.insertAdjacentElement("afterend", document.createElement("div"));

        if (usingDemoValues) {
            idToCategory = [];
        }

        let catId = idToCategory.indexOf(categ);
        let isNewCategory = catId === -1;
        catId = isNewCategory ? idToCategory.push(categ) - 1 : catId;

        const entry = [engTerm, espTerm, notes, catId, null, getSearchableString([engTerm, espTerm])];

        if (usingDemoValues) {
            fullList = [];
            fuse.setCollection(fullList);
            usingDemoValues = false;
        }

        fuse.add(entry);

        database.storeSingle(entry.slice(0, 4), true, isNewCategory)
        .then(key=>{entry[4] = key});

        clearInputs();
        hide();

    }

    return {
        nameInput: engInput,
        addButton,
        returnButton,

        addVtoHandler: addTermHandler,
        hide,
        unHide,
    }
})();


const translationsGrid = (()=> {
    
    let tileStyle = "grid-tile-strip";
    
    const addGridTileClassName = "add-grid-tile";
    const addTranslationTile = document.createElement("div");
    addTranslationTile.innerText = "Agregar traducción";
    addTranslationTile.id = "add-term-tile";
    
    addTranslationTile.addEventListener("click", addTermMenu.unHide);
    addTranslationTile.classList.add(tileStyle, addGridTileClassName);

    const tileTemplate = document.createElement("div");
    tileTemplate.setAttribute("data-is-tile", "true");
    
    const grid = document.getElementById("items-display-container");
    const opts = document.getElementById("tile-options");

    function handleOptsButton(button){
        if (button.id === "tile-options-cancel") {
            selectedWrapper.classList.remove("selected-wrapper");
            selectedWrapper = null;
            opts.style="display: none";
            return;
        }
        if (button.id === "tile-options-delete") {
            const index = selectedWrapper.firstElementChild.getAttribute("data-index");
            
            const databaseKey = fullList[index][4];
            
            //fullList.splice(index, 1); // Can't splice because de-links elements data-index from the corresponding index in fullist.
            delete fullList[index]; // Can't do delete to leave a sparse array because it messes the fuse search.
            fuse.setCollection(fullList); // Can fix by resetting the collection.

            selectedWrapper.remove();
            selectedWrapper = null;
            if (databaseKey) database.remove(databaseKey);
            return;
        }
    }

    let selectedWrapper = null;
    
    grid.addEventListener("click", (ev)=> {
        
        if (getComputedStyle(ev.target).cursor !== "pointer" || ev.target === addTranslationTile) return;

        let wrapper = ev.target, iter = 0;

        while (!wrapper.getAttribute("data-is-wrapper") && iter++ < 10) {
            wrapper = wrapper.parentElement;
            if (wrapper === opts) {
                handleOptsButton(ev.target);
                return;
            };
        }

        if (selectedWrapper !== wrapper) {
            selectedWrapper?.classList.remove("selected-wrapper");
            wrapper.classList.add("selected-wrapper");
            selectedWrapper = wrapper;
            wrapper.appendChild(opts);
            opts.style="margin: 0; padding: 0.5ch 1ch 0.5ch 1ch";
        }

    });
    
    return {
        
        element: grid,
        
        addTranslationTile,
        
        hide() {
            this.element.style.display = "none";
            this.element.hidden = true;
        },
        unHide() {
            this.element.style.display = "grid";
            this.element.hidden = false;
        },
        
        enableAddTranslationTile() {
            this.element.appendChild(this.addTranslationTile);
        },
        
        disableAddTranslationTile() {
            this.addTranslationTile.remove();
        },
        clear() {
            this.element.innerHTML = "";
        },
        
        createTile(entry, indexInFullList) {

            const div = tileTemplate.cloneNode();
            div.classList.add(tileStyle);
            div.setAttribute("data-index", indexInFullList);

            const textContent = `${entry[0]} = ${entry[1]}`;
            const category = idToCategory[entry[3]];

            div.innerHTML = `<div style="display: inline; margin: 0.4ch 0 ;">[${category}] <b>${textContent}</b></div>`;

            const wrapper = document.createElement("div");
            wrapper.setAttribute("data-is-wrapper", "1");
            wrapper.appendChild(div);

            if (entry[2]) {
                
                const noteTile = tileTemplate.cloneNode();
                noteTile.classList.add("note-tile");
                noteTile.classList.add(tileStyle);
                noteTile.innerText = entry[2];

                
                wrapper.appendChild(noteTile);
                
            }
            
            return wrapper;

        },
        
        appendTile(tile) {
            this.element.appendChild(tile);
            return tile;
        },
        
        fill(startIndex = 0, maxAmount = 250) {

            this.clear();

            let i = startIndex, count = 0;
            while (count < maxAmount && i < fullList.length) { //Must handle sparse arrays
                
                if (!(i in fullList)) {i++; continue;}

                this.appendTile(this.createTile(fullList[i], i++));
                count++;
            }
        },
        
        setStyles(gridClassName, tileClassName) {

            this.element.className = gridClassName;
            tileStyle = tileClassName;
            addTranslationTile.className = `${tileStyle} ${addGridTileClassName}`;

            for (const tile of this.element.children) {
                tile.className = tileStyle;
            }
        }
        
    }
})();

try {
    displayInfo("Cargando entradas guardadas...")
    const N = await database.retrieveAll(true).then(handleRetrievedEntries);
    displayInfo(N ? `${N} entradas cargadas!` : "No se encontraron entradas cargadas." );
} catch (err) {
    displayInfo("⚠ Error al cargar datos guardados.");
    console.error(err);
}


document.getElementById("import-2").addEventListener("click", async _=>{

    Promise.resolve().then(_=>{
        const userConfirmed = window.confirm("Esto BORRARÁ las entradas actuales. Continuar?");
        if (!userConfirmed) return;

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json";

        fileInput.onchange = (changeEv)=> {
            const file = changeEv.target.files[0];
            if (!file) {
                console.log("No file selected.");
                return;
            }

            const reader = new FileReader();

            reader.onload = (loadEv)=> {
                try {
                    const jsonString = loadEv.target.result;
                    const jsonArray = JSON.parse(jsonString);

                    if (!Array.isArray(jsonArray)) {throw new TypeError("Loaded JSON is not an array")}

                    database.clear()
                    .then(_=>database.storeBulk(jsonArray))
                    .then(_=>database.retrieveAll(true))
                    .then(handleRetrievedEntries)
                    .catch(err=>console.error("Database error:", err));

                } catch (err) {
                    console.error("Error parsing JSON file:", err);
                }
            };

            reader.onerror = (errorEv)=> {
                console.error("Error reading file:", errorEv.target.error);
            };

            reader.readAsText(file);
        };

        fileInput.click();
        
    })
    
});

search.addEventListener("input", ()=>{
    const target = search.value;

    if (target === "") {
        translationsGrid.fill();
        return;
    }

    translationsGrid.clear();

    let lim = 10

    const result = fuse?.search(target, {limit: lim}) || [];

    lim = Math.min(result.length, lim);

    for (let i = 0; i < lim; i++) {

        const indexInFullList = result[i].refIndex;
        const entry = fullList[indexInFullList];

        if (!entry) console.warn(result) //TODO: after deletion still searches

        translationsGrid.appendTile(translationsGrid.createTile(entry, indexInFullList));
    }
    translationsGrid.enableAddTranslationTile();

});

document.getElementById("options-button").addEventListener("click", _=>{
    document.getElementById("options-container").hidden ^= true;
});

document.getElementById("delete-all").addEventListener("click", _=>{
    const doDelete = window.confirm("Borrar todas las entradas?");
    if (!doDelete) return;

    fullList.length = 0;
    idToCategory.length = 0;
    fuse.setCollection(fullList);
    database.clear();
    search.dispatchEvent(new Event("input"));
    
});

document.getElementById("download").addEventListener("click", ()=>{
    const dlArr = [Array.from(idToCategory)].concat(fullList.map(entry=>entry.slice(0, 4)));
    downloadObjAsJson(dlArr)
});

window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    const install = document.getElementById("install");
    install.hidden = false;

    install.addEventListener("click", async ()=>{
        try {
            await ev.prompt();
        } catch (error) {
            window.alert("Para poder instalar la app, por favor recargue la página e intente nuevamente.")
        }
    });
});


search.dispatchEvent(new Event("input"));


function downloadObjAsJson(obj, filename = "descarga") {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename + ".json";
    a.click();
    URL.revokeObjectURL(url);
}


function displayInfo(msg) {
    const display = document.getElementById("info-msg");
    display.innerText = msg;
    display.classList.remove("fadeOut");
    display.classList.add("fadeOut");
}


function formatImportedEntries(entriesArray){
    
    const maxCategoryId = idToCategory.length - 1;

    let highestIdFound = -Infinity;

    for (const entry of entriesArray) { //["eng", "esp", "note", catID, indexedDBID, "searchableString"] -> build display name 
        entry[5] = getSearchableString(entry);
        highestIdFound = Math.max(highestIdFound, entry[3]);
    }
    if (highestIdFound > maxCategoryId) {
        throw new RangeError(`Category ID ${highestIdFound} doesn't have a matching category name.`);
    }

    return entriesArray;
}

function getSearchableString(entry) {
    return `${entry[0]} = ${entry[1]}`.replace(/[()=\/]/g, "");
}

function handleRetrievedEntries(entries) {

    if (entries.length === 0) return 0;

    idToCategory = entries.shift().slice(0, -1) || [];
    fullList = formatImportedEntries(entries);
    //fuse = new Fuse(fullList, fuseOptions);

    fuse.setCollection(fullList)

    search.dispatchEvent(new Event("input"));
    return entries.length
}
