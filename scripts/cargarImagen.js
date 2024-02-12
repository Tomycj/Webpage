// Carpeta con las imágenes
const folderPath = "./images/fotos/"; // Path relativo DESDE INDEX.HTML (la página que llama al script)
const maxWidth = 600;
const images = [
	["4.6 Billion Light Years por JWST.jpg", 2799, 2856],
	["Advanced Inertial Reference System.jpg", 962, 962],
	["Astronaut Under Engines.jpg", 1920, 960],
	["Buscando Respuestas.jpg", 669, 829],
	["Cantos Rodados en Marte.jpg", 1584, 1184],
	["Cielo Australiano.jpg", 619, 767],
	["Espuma Marina.jpg", 1556, 1100],
	["Falcon 9.jpg", 1048, 698],
	["Imagen compuesta por Chandra.jpg", 3600, 2850],
	["Inside the Large Hadron Collider.jpg", 3872, 2592],
	["ITS.jpg", 1380, 2048],
	["JWST.jpg", 803, 452],
	["Júpiter.jpg", 2000, 1125],
	["LHC.jpg", 6016, 4000],
	["Nebulosa.jpg", 1920, 1080],
	["Nixie RNG por skyliners_a340.jpg", 2880, 2160],
	["Positano por u-scottishswan.jpg", 510, 767],
	["Saturno.jpg", 3545, 1834],
	["Semáforo por u-revraul.jpg", 1024, 683],
	["Starship - RGV Aerial Photography.jpg", 2414, 4096],
	["Toronto.jpg", 1586, 1982],
	["Última misión Gémini.jpg", 857, 894],
	// With "Get images data.py"
];

// Función que obtiene foto random
function getRandomImage(images) {
	const randomIndex = Math.floor(Math.random() * images.length);
	return images[randomIndex];
}

// Obtener el título a partir del nombre de archivo
function getTitleFromFilename(filename) {
	return filename.split(".").slice(0, -1).join(".");
}

// Cargar imagen y agregar label
function loadRandomImage() {
	
	const [imageFilename, x, y] = getRandomImage(images);
	const imageUrl = folderPath + imageFilename;

	const img = new Image();
	img.src = imageUrl;
	
	img.style = `display: block; max-width: ${maxWidth}px; `;
	const x2 = Math.min(maxWidth, x);
	const y2 = x2/x*y;

	const loadZone = document.getElementById("loading-zone");
	loadZone.style=`width: ${x2}px; height: ${y2}px; font-size 300px;`;

	/*	Alternative to preload image dimensions
		let t;
		const id = setInterval( _=> {
			if (img.naturalWidth && img.naturalHeight) {
				clearInterval(id);
				const x = img.width;
				const y = img.height;

				const x2 = Math.min(600, x);
				const y2 = x2/x*y;

				loadZone.style=`width: ${x2}px; height: ${y2}px;`;
				loadZone.hidden = false;
				console.log("square " + performance.now())
			}
			else if (t > 3000) {
				console.log("timed out " + performance.now())
				clearInterval(id);
			}
			t += 10;
		}, 10);
	*/

	const imageLabel = document.getElementById("image-label");
	const imageContainer = document.getElementById("image-container");
	const imageLink = document.getElementById("image-link");
	imageLabel.innerText = getTitleFromFilename(imageFilename);

	img.onload = _=> {
		imageContainer.style.boxShadow = "none";
		imageLink.appendChild(img);
		img.style.animation = "from-blur 0.5s both";
		imageLabel.hidden = false;
		setTimeout(_=> {loadZone.hidden = true;}, 100)
	};
}

// Inicializar
loadRandomImage();