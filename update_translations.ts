const config = require("./config.json");
const fs = require('fs');

var Airtable = require('airtable');
var async = require('async');
var base = new Airtable({apiKey: config["apiKey"]}).base(config["baseURL"]);
process.env.GOOGLE_APPLICATION_CREDENTIALS=config["pathToGoogleFile"];
const {Translate} = require('@google-cloud/translate').v2;
const translate = new Translate({projectId:'share-meals-dev'});

const langObj = {
  Spanish: 'es',
  Chinese: 'zh',
  'Haitian Creole':'ht',
  Portuguese: 'pt',
}

// MOST IMPORTANT MOVING FORWARD
// hours need a different implementation
// update extra notes for hours e.g. Su 01:00PM-03:00PM "Only every other week" update part in quotes

// fill in to config.josn
//    {
    //   "name":"Retail Food Stores",
    //   "languages":["Spanish"],
    //   "fieldsToTranslate":["Delivery and Additional Notes","Store Hours"],
    //   "lastUpdatedName":"Last Updated"
    // }
// {
//   "name":"Food Pantries",
//   "languages":["Spanish"],
//   "fieldsToTranslate":["Additional Notes","Hours FPC"],
//   "lastUpdatedName":"Last Updated FPC"
// },
// {
//   "name":"Social Services",
//   "languages":[],
//   "fieldsToTranslate":[]
// },
function update_translations(language,table,fieldsToTranslate,hoursFieldsToTranslate,lastUpdatedName){
  let translateArr = [];
  let flagRecordArr = [];
  let flagStr = "";
  let filterStr = "OR(";
  fieldsToTranslate.forEach(field => {
    filterStr += "NOT({" + field + "} = BLANK()),";
  });
  filterStr = filterStr.substring(0,filterStr.length-1);
  filterStr += ")"
  return new Promise((resolve, reject) => {
    base(table).select({
      maxRecords: config["maxRecords"],
      pageSize:100,
      filterByFormula: `and(search(\"${language}\",{Languages to Translate to}) > 0,or({Last Updated ${language}} = BLANK(),datetime_diff({${lastUpdatedName}},{Last Updated ${language}},\'s\') > 0),${filterStr})`
    }).eachPage(function page(records, fetchNextPage) {
      records.forEach(function(record) {

        fieldsToTranslate.forEach((field) => {
          const text = typeof record.get(field) == 'undefined' ? "" : record.get(field).trim()
          if(text != ""){
            if(text.length < config["maxTranslateLength"]){
              translateArr.push({
                "id":record["id"],
                "field":field,
                "text":text
              })
            }
            else {
              // assuming that all tables will have an id field
              fs.appendFileSync('flag_log.csv',`${new Date()},${table},${record.get("id")}\n`);

            }
          }
        })

      });

      fetchNextPage();

    }, async function done(err) {
      await translate_text(translateArr,language,table)
      resolve();
      if (err) { console.error(err); return; }
    });
  })
}

async function xtranslate_text(translateArr,language,table){
  let temp = []
  for(var i = 0;i<translateArr.length;i++){
    temp[i] = i.toString();
  }
  build_update(translateArr,temp,language,table)
}

async function translate_text(translateArr,language,table){
  if (translateArr.length == 0){
    console.log("translate array is empty");
    return;
  }
  let text = [];
  let charCount = 0;
  let temp = [];
  let numCharsTranslated = 0;
  let numRecordsTranslated = 0;
  translateArr.forEach(element => {
    if((charCount + element["text"].length) > config["charsToTranslate"]){
      text.push(temp);
      charCount = 0;
      temp = []
    }
    numRecordsTranslated++;
    charCount += element["text"].length;
    numCharsTranslated += element["text"].length;
    temp.push(element["text"]);
  });
  fs.appendFileSync('log.csv',`${new Date()},${table},${numRecordsTranslated},${numCharsTranslated}\n`);
  text.push(temp);
  const target = langObj[language];
  let resultArr = [];
  for(var i = 0;i<text.length;i++){
    let arr = text[i];
    let [translations] = await translate.translate(arr, target);
    translations = Array.isArray(translations) ? translations : [translations];

    translations.forEach(translation => {
      resultArr.push(translation);
    });

  };

  build_update(translateArr,resultArr,language,table);
}

function build_update(translateArr,resultArr,language,table){
  let finalUpdateObj = {};
  let updateObj = {}
  for(var i = 0;i<resultArr.length;i++){
    if(!finalUpdateObj[translateArr[i]["id"]]){
      updateObj = {};
      updateObj["id"] = translateArr[i]["id"];
      updateObj["fields"] = {};
      updateObj["fields"][translateArr[i]["field"] + " " + language] = resultArr[i];
      updateObj["fields"]["Last Updated " + language] = new Date();
      finalUpdateObj[translateArr[i]["id"]] = updateObj;
    }
    else {
      finalUpdateObj[translateArr[i]["id"]]["fields"][translateArr[i]["field"] + " " + language] = resultArr[i];
    }
  }

  update_airtable(Object.values(finalUpdateObj),table);
}

function update_airtable(updateArr,table){
  chunk = 3;
  let allChunks = [];
  for (i=0;i<updateArr.length;i+=chunk) {
    temp= updateArr.slice(i,i+chunk);
    allChunks.push(temp);
  }

  allChunks.forEach((chunk) => {
    base(table).update(chunk, function(err, records) {
      if (err) {
        console.error(err);
        return;
      };
      console.log("done " + table);
  });
  })
}
config["tables"].forEach(table => {
  table["languages"].forEach(language => {
      update_translations(language,table["name"],table["fieldsToTranslate"],[],table["lastUpdatedName"]);
    });
});
