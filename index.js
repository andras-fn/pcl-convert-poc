const fileWatcher = require("chokidar");
const config = require("./config.json");
//const async = require("async");
const log = require("node-file-logger");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const queue = require("fastq").promise(worker, config.dbsvpdfInstanceNo);

// options for log file generator
const options = {
  timeZone: "Europe/London",
  folderPath: "./logs/",
  dateBasedFileNaming: true,
  // Required only if dateBasedFileNaming is set to true
  fileNamePrefix: "",
  fileNameSuffix: "",
  fileNameExtension: ".log",

  dateFormat: "YYYY-MM-DD",
  timeFormat: "HH:mm:ss.SSS",
  logLevel: "debug",
  onlyFileLogging: true,
};

log.SetUserOptions(options);

// helper function for logging to log and console
function logger(message) {
  log.Info(message);
  console.log(message);
}

logger(`--- Starting ---`);

// Create list of folders to watch
const folderPaths = (folder) => {
  return [
    `${config.watchDir}/*.pcl`,
    `${config.watchDir}/*.PCL`,
    `${config.watchDir}/*.Pcl`,
  ];
};

// Initialize watcher
const watcher = fileWatcher.watch(`${config.watchDir}/*.pcl`, {
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
});

// do the cleanup after successfully converting pcl
async function processSuccess(fileObj) {
  logger(`Deleting this file: "${fileObj.filePath}" because of success`);

  // move pcl to failed folder
  if (fs.existsSync(fileObj.filePath)) {
    logger("PCL file exists, safe to try and move");
    try {
      fs.unlinkSync(fileObj.filePath);
      logger(`Deleted File: ${fileObj.filePath}`);
    } catch (e) {
      logger(
        `Failed to delete file: ${fileObj.filePath} because of error: ${e}`
      );
    }
  }
}

// do the cleanup after failing to convert pcl
async function processFailed(fileObj) {
  logger(
    `Moving this file: "${fileObj.filePath}" to Failed Directory: "${config.failedPdfDir}"`
  );

  // move pcl to failed folder
  if (fs.existsSync(fileObj.filePath)) {
    logger("PCL file exists, safe to try and move");
    try {
      fs.renameSync(
        fileObj.filePath,
        path.join(config.failedPdfDir, fileObj.filename)
      );
      logger(`Successfully moved file: ${fileObj.filePath}`);
    } catch (e) {
      logger(`Failed to move file: ${fileObj.filePath} because of error: ${e}`);
    }
  }
}

// watch for added files
watcher.on("add", async function doEverything(file) {
  try {
    logger(`Found file: ${file}`);
    // construct object based on filepath info
    // split file path in to arr
    const filenameArr = file.split("\\");

    // get the filename
    const filename = filenameArr[filenameArr.length - 1];

    // check filename for spaces and if they're found rename it
    // split filename on spaces
    const filenameSpaceArr = filename.split(" ");

    // check if resultant array is greater than 0
    if (filenameSpaceArr.length > 1) {
      // filename has spaces, rename
      // remove spaces from filename array
      const filenameNoSpaceArr = filenameSpaceArr.map((letter) => {
        if (letter !== " ") {
          return letter;
        }
      });

      // join the resultant array
      const filenameNoSpace = filenameNoSpaceArr.join("");

      // new pcl name
      const fullFilenameNoSpace = path.join(config.watchDir, filenameNoSpace);

      // log it
      logger(`File has spaces. Rename from ${file} to ${fullFilenameNoSpace}`);

      // rename file
      fs.renameSync(file, fullFilenameNoSpace);
    } else {
      // get the filename without the extension
      const filenameNoExtArr = filename.split(".");
      filenameNoExtArr.pop();
      const filenameNoExt = filenameNoExtArr.join(".");

      // get the failed folder path
      const failedFolder = config.failedPdfDir;

      // create the filedetails object
      const fileDetails = {};

      // add properties to the filedetails object
      fileDetails.filePath = file;
      fileDetails.filename = filename;
      fileDetails.filenameNoExt = filenameNoExt;
      fileDetails.failedFolder = failedFolder;

      // push details to the convert pcl queue
      logger(`Pushing file: ${fileDetails.filePath} to the convert queue`);
      queue.push(fileDetails);
    }
  } catch (e) {
    logger(e);
  }
});

// convert pcl to pdf Queue
async function worker(task) {
  try {
    logger(`Running dbsvpdf for file: ${task.filePath}`);

    // create the conversion command
    const dbsvpdfCmd = `"${config.dbsvpdfPath}" "${task.filePath}" "${config.pdfDir}\\${task.filenameNoExt}.pdf"`;

    // create the pdf file name
    const pdfFilePath = `${config.pdfDir}\\${task.filenameNoExt}.pdf`;

    if (config.logCommands) {
      logger(`DbSVPDF CMD: ${dbsvpdfCmd}`);
    }

    // run the dbsvpdf command
    // var result = execSync(dbsvpdfCmd).toString();
    // var result = execFileSync(config.dbsvpdfPath, [
    //   task.filePath,
    //   pdfFilePath,
    // ]).toString();

    exec(`${dbsvpdfCmd}`, async (err, stdout, stderr) => {
      if (err || stderr) {
        // error from the commandline
        if (err) {
          console.log(`An error has occurred: ${err}`);
          log.Info(`An error has occurred: ${err}`);
        } else if (stderr) {
          console.log(`An stdout error has occurred: ${stderr}`);
          log.Info(`An stdout error has occurred: ${stderr}`);
        }

        await fs.renameSync(task.path, failedPath);
        console.log("Successfully moved the XML to the Failed Directory");
        log.Info("Successfully moved the XML to the Failed Directory");
      } else {
        // no error from commandline
        // check if pdf exists
        if (fs.existsSync(pdfFilePath)) {
          // do success stuff
          logger(`Conversion successful for ${task.filePath}`);
          processSuccess(task);
        } else {
          // do failed stuff
          logger(`Conversion failed for ${task.filePath}`);
          processFailed(task);
        }
      }
    });
  } catch (e) {
    // something bad happened
    logger(e);
    processFailed(task);
  }
}
