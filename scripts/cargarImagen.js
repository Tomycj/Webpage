// Carpeta con las imágenes
const folderPath = "./images/fotos/"; // Path relativo DESDE INDEX.HTML (la página que llama al script)

// Función que obtiene foto random
function getRandomImage() {
  const images = [
	"4.6 Billion Light Years por JWST.jpg",
	"Advanced Inertial Reference System.jpg",
	"Astronaut Under Engines.jpg",
	"Buscando Respuestas.jpg",
	"Cantos Rodados en Marte.jpg",
	"Cielo Australiano.jpg",
	"Espuma Marina.jpg",
	"Falcon 9.jpg",
	"Positano por u-scottishswan.jpg",
	"Imagen compuesta por Chandra.jpg",
	"Inside the Large Hadron Collider.jpg",
	"ITS.jpg",
	"Júpiter.jpg",
	"JWST.jpg",
	"LHC.jpg",
	"Nebulosa.jpg",
	"Nixie RNG por skyliners_a340.jpg",
	"Saturno.jpg",
	"Semáforo por u-revraul.jpg",
	"Starship - RGV Aerial Photography.jpg",
	"Toronto.jpg",
	"Última misión Gémini.jpg",
	// Agregar más aquí
  ];

  const randomIndex = Math.floor(Math.random() * images.length);
  return images[randomIndex];
}

// Obtener el título a partir del nombre de archivo
function getTitleFromFilename(filename) {
  return filename.split('.').slice(0, -1).join('.');
}

// Cargar imagen y agregar label
function loadRandomImage() {
  const imageContainer = document.getElementById('imageContainer');
  const imageFilename = getRandomImage();
  const imageUrl = folderPath + imageFilename;
  const imageTitle = getTitleFromFilename(imageFilename);

  const img = new Image();
  img.src = imageUrl;

  img.onload = function() {
	imageContainer.innerHTML = '';

	if (img.width > 600) {
	  const scaleFactor = img.width / img.height ;
	  img.width = 600;
	  img.height = 600 / scaleFactor;
	}

	const imageLink = document.createElement('a');
	imageLink.href = './Cells.html';
	imageLink.title = 'Ir a Cells'
	imageLink.appendChild(img);
	imageContainer.appendChild(imageLink);

	const imageLabel = document.createElement('div');
	imageLabel.classList.add('imageLabel');
	imageLabel.innerText = imageTitle;
	imageContainer.appendChild(imageLabel);
  };
}

// Inicializar
loadRandomImage();