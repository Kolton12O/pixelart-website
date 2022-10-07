const { Image } = require("image-js");
const { workerData } = require("worker_threads");
const UUID_MAKER = require("uuidjs");

const fs = require("fs");
const path = require("path");

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const allowedBlocks = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../image-maker/allowedblocks.json"))
).blocks;

const colors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../image-maker/savedBlocks.json"))
);
const nearestColor = require("nearest-color").from(colors);

const BLOCK_SIZE = 16; // Pixels size of blocks
const SLICE_SIZE = 10; // Amount of Pixels per slice

let DATABASE;

let cachedPhotos = [];


(async() => {
  await loadMinecraftImagesIntoCache();

  const DATABASE_PATH = path.resolve(__dirname, __dirname, "../db/images.db");

  try {
    DATABASE = await createDbConnection(DATABASE_PATH);
  } catch(err) {
    await handleError({error: err, uuid: workerData.UUID});
    return;
  }

  start(workerData.UUID);

})();

async function start(UUID) {

  let ROW; 
  try {
    ROW = await getDatabaseRow(UUID);
  } catch(err) {
    await handleError({error: err, uuid: workerData.UUID});
    return;
  }

  let IMG;
  try { 
    IMG = await Image.load(ROW.FILE_PATH);
  } catch(err) {
    await handleError({uuid: UUID, error: "There was an error processing your image. The image may be corrupted. Please try again"});
    return;
  }

  
  try {
    IMG = await resizeImage(IMG);

    let NEW_IMG = await createNewImage(IMG.width, IMG.height);

    NEW_IMG = await doWeirdWork({image: IMG, new_image: NEW_IMG, uuid: UUID});

    await NEW_IMG.save(ROW.FILE_PATH, { format: "png"});

    await setDatabaseValue({uuid: UUID, key: "FINISHED" ,value: 1});

  } catch (err) {
    console.error(err);

    await handleError({error: err, uuid: UUID});

    return;
  }

  try {
  await DATABASE.close();
  } catch(err) {
    console.error(err);
  }

}

function setDatabase(db) {
  DATABASE = db;
}

async function setDatabaseValue({ uuid, key, value } ) {
    const sql = `UPDATE images SET ${key} = ? WHERE UUID = ?`;
	await DATABASE.run(sql, [value, uuid]);
}

async function getDatabaseRow(u) {
  const sql = `SELECT * FROM images WHERE UUID = ?`;
  const r = await DATABASE.get(sql, [u]);
  return r;
}

async function doWeirdWork({ image, new_image, uuid } ) {
  // Main image manipulation
  // get how many slizes
  let widthSlices = Math.floor(image.width / SLICE_SIZE);
  let heightSlices = Math.floor(image.height / SLICE_SIZE);

  for (let w = 0; widthSlices > w; w++) {
    // loop width
    for (let h = 0; heightSlices > h; h++) {
      // loop height
      const histo = await image.crop({
        x: SLICE_SIZE * w,
        y: SLICE_SIZE * h,
        width: SLICE_SIZE,
        height: SLICE_SIZE,
      });

      const result = getAverageColor(histo);

        let blockImage =
          cachedPhotos[
            allowedBlocks.indexOf(
              nearestColor(rgbToHex(result[0], result[1], result[2])).name
            )
          ];

        await new_image.insert(await blockImage, {
          x: BLOCK_SIZE * w,
          y: BLOCK_SIZE * h,
          inPlace: true,
        });
      

    }
  }
  return new_image;
}

async function handleError({error, uuid}) {
  console.error(err);
  // Unlink files
  try {
    const ROW = getDatabaseRow(uuid);
    fs.unlinkSync(ROW.FILE_PATH);
    fs.unlinkSync(path.dirname(ROW.FILE_PATH));
  } catch(err) {
    console.error(err);
  }

  // Send error message to DB

  try {
    await setDatabaseValue({uuid: uuid, key: "MESSAGE" , value: error.toString()});
    await setDatabaseValue({uuid: uuid, key: "FINISHED" , value: -1});
  } catch(err) {
    console.error(err);
  }

  try {
  await DATABASE.close();
  } catch(err) {
    console.error(err);
  }
}

function searchArr(arr, name) {
    for (let i = 0; arr.length > i; i++) {
      if (arr[i].name === name) return true;
    }
    return false;
  }

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

async function loadMinecraftImagesIntoCache() {
  for (ci = 0; allowedBlocks.length > ci; ci++) {
    let mc = await Image.load(
      path.resolve(__dirname, `../image-maker/blocks/${allowedBlocks[ci]}`)
    );
    cachedPhotos.push(mc);
  }
}

async function createNewImage(w, h) {
  const img = new Image({
    width: Math.floor(w / SLICE_SIZE) * 16,
    height: Math.floor(h / SLICE_SIZE) * 16,
    kind: "RGB",
    alpha: 1
  });
  return img;
}

async function resizeImage(img) {
  /**
   * 
   * Resize the image with the factor of WIDTH_AND_HEIGHT
   * so the size does not exceed the value of WIDTH_AND_HEIGHT
   *
  **/
 
  let WIDTH_AND_HEIGHT = 5000; // Pixels
  
  WIDTH_AND_HEIGHT = Math.floor(WIDTH_AND_HEIGHT / BLOCK_SIZE) * SLICE_SIZE;


    if (img.width > img.height) {
      img = await img.resize({
        factor: WIDTH_AND_HEIGHT / img.width,
        interpolation: "nearestNeighbor",
      });
    } else {
      img = await img.resize({
        factor: WIDTH_AND_HEIGHT / img.height,
        interpolation: "nearestNeighbor",
      });
    }
  return img;
}

function getAverageColor(img) {
  const h = img.getHistograms({ maxSlots: img.maxValue + 1 });

  let r = new Array(h.length);
  for (let c = 0; c < h.length; c++) {
    let histogram = h[c];
    r[c] = Math.floor(mean(histogram));
  }

  return r;
}

function mean(histogram) {
  let total = 0;
  let sum = 0;

  for (let i = 0; i < histogram.length; i++) {
    total += histogram[i];
    sum += histogram[i] * i;
  }
  if (total === 0) {
    return 0;
  }

  return sum / total;
}

async function createDbConnection(file) {

  try {
    if(!fs.existsSync(path.resolve(__dirname, "../db"))) fs.mkdirSync(path.resolve(__dirname, "../db"));
    if(!fs.existsSync(path.resolve(__dirname, "../db/images.db"))) fs.writeFileSync(path.resolve(__dirname, "../db/images.db"), "");
  } catch(err) {
    console.error(err);
  }

  let db = await open({ filename: file, driver: sqlite3.Database });

  await db.run("CREATE TABLE IF NOT EXISTS images(UUID TEXT, FILE_PATH TEXT, START_TIME NUMERIC, MESSAGE TEXT, FINISHED NUMERIC)");

  return db;

}


module.exports = {
  start,
  setDatabase,
};
