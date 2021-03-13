const cron = '44 14 * * *';
// https://crontab.guru/
const region = 'us-east1';
// region needs to be fixed using stackoverflow post
const timeZone = 'America/New_York';


// DO NOT EDIT ANY CODE BELOW THIS LINE


const functions = require("firebase-functions");
const Translator = require("./update_translations.ts")
const config = require("./config.json");
let t = new Translator(config);

// need to make region, cron, and timezone in config
// for setting region in firebase, look at answer by Nick Foden below
// https://stackoverflow.com/questions/58579042/firebase-project-initialization-error-cloud-resource-location-is-not-set-for-th
exports.translations = functions.region(region).pubsub.schedule(cron)
  .timeZone(timeZone)
  .onRun(async (context) =>{
    console.log("every minute")
    for (const table of config["tables"]) {
      for (const language of table["languages"]){
        await t.executeTranslation();
      }
    }
  })
