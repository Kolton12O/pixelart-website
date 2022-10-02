const express = require("express");
const { Worker } = require("worker_threads");
const UUID_MAKER = require("uuidjs");

//const imageMaker = require("../image-maker");

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const fs = require("fs");
const path = require("path");

const fileUpload = require("express-fileupload");
const rateLimit = require("express-rate-limit");

let DATABASE;

const DATABASE_PATH = path.resolve(__dirname, "../db/images.db");
createDbConnection(DATABASE_PATH);

const cookieParser = require("cookie-parser");

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 250, // Limit each IP to 250 requests per `window` (here, per 10 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const app = express();
const port = process.env.PORT || 3000;

app.use("/getImage", apiLimiter);

app.use(
  fileUpload({
    limits: { fileSize: 10000000 },
    abortOnLimit: false,
    responseOnLimit: "File size limit has been reached",
  })
);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  if (!DATABASE) return res.status(404).send("Error");
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "./home/index.html"));
});

app.get("/image", async (req, res) => {
  if(!req?.query?.id) return res.sendStatus(204);

  const ROW = await getImage(req?.query?.id, true);

  if(!ROW) return res.sendStatus(204);

  res.sendFile(ROW.FILE_PATH);
});

app.post("/start", async (req, res) => {
  const COOKIES = req.cookies;

  try {
    const doesUserHasImageBeingMade = await userHasImageBeingMade(COOKIES.UUID);

    if (doesUserHasImageBeingMade) {
      return res.redirect("/create?id=" + COOKIES.UUID);
    }
  } catch (err) {
    console.log(err);
    return res.send(err);
  }

  const UUID = UUID_MAKER.generate();

  // Get the file that was set to our field named "image"
  const file = req.files;

  if (file?.image?.truncated) return res.redirect("/#MAX_FILE_SIZE");
  // If no image submitted, exit
  if (!file?.image) return res.redirect("/#NO_FILE");

  // If does not have image mime type prevent from uploading
  if (!/^image/.test(file?.image.mimetype))
    return res.redirect("/#NOT_IMAGE_FILE");

  // Move the uploaded image to our upload folder
  fs.mkdirSync(__dirname + "/upload/" + UUID);
  const FILE_PATH = __dirname + "/upload/" + UUID + "/" + file?.image.name;
  file?.image.mv(FILE_PATH);

  // All good
  //res.redirect('/start');

  res.cookie("UUID", UUID);

  try {
    await addUserToDatabase({ UUID: UUID, PATH: FILE_PATH });
  } catch (err) {
    console.log(err);
    return res.send(err);
  }

  res.redirect("/create?id=" + UUID);

  const w = new Worker(path.resolve(__dirname, "../image-maker/index.js"), { workerData: { UUID: UUID, DATABASE: DATABASE_PATH } });
  w.on("error", (err) => {
    console.log(err);
  });
  //imageMaker.start({UUID: UUID});
});

app.get("/create", (req, res) => {
  res.sendFile(path.resolve(__dirname, "./create/index.html"));
});

app.post("/getImage", async (req, res) => {
  if (!req.body.UUID)
    return res.send({
      status: "error",
      message: "Request is formatted incorrectly!",
    });

  let IMAGE;
  try {
  IMAGE = await getImage(req.body.UUID);
  } catch(err) {
    console.log(err);
    return res.send(err);
  }

  if (IMAGE) {
    return res.send({ status: "ok", image: IMAGE });
  }

  return res.send({ status: "ok", message: "Unknown ID." });

  //return res.send({status: "ok", message: "Image is not finished yet!"});
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

async function getImage(u, showFilePath = false) {
  const sql = `SELECT * FROM images WHERE UUID = ?`;
  const r = await DATABASE.get(sql, [u]);
  if(r && !showFilePath) delete r.FILE_PATH;
  return r;
}

async function addUserToDatabase({ UUID, PATH }) {
  const sql = `INSERT INTO images VALUES (?, ?, ?, ?, ?)`;
  await DATABASE.run(sql, [UUID, PATH, new Date().getTime(), null, 0]); // This might need to be await?
}

async function userHasImageBeingMade(u) {
  const sql = `SELECT * FROM images WHERE UUID = ? AND FINISHED = 0`;
  const r = await DATABASE.get(sql, [u]);
  return r ? true : false;
}

async function createDbConnection(file) {
  console.log("Connecting to " + path.basename(file) + " Database...");

  let db;
  try {
    db = await open({ filename: file, driver: sqlite3.Database });
  } catch (err) {
    console.error(err);
  }

  console.log("Connected to " + path.basename(file) + " Database!");

  console.log("Creating to " + path.basename(file) + " Database tables...");

  try {
    await db.run(
      "CREATE TABLE IF NOT EXISTS images(UUID TEXT, FILE_PATH TEXT, START_TIME NUMERIC, MESSAGE TEXT, FINISHED NUMERIC)"
    );
  } catch (err) {
    console.error(err);
  }

  console.log(path.basename(file) + " Database tables created!");

  DATABASE = db;

  //imageMaker.setDatabase(db);

}
