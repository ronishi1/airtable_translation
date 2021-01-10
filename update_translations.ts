const config = require("./config.json");
const fs = require('fs');
const { WebClient, LogLevel } = require("@slack/web-api");

var Airtable = require('airtable');
var async = require('async');
var base = new Airtable({apiKey: config["apiKey"]}).base(config["baseURL"]);
process.env.GOOGLE_APPLICATION_CREDENTIALS=config["pathToGoogleFile"];
const {Translate} = require('@google-cloud/translate').v2;
const translate = new Translate({projectId:'project-id-here'});

const update_chunk_size = 10;

const langObj = {
  Spanish: 'es',
  Chinese: 'zh',
  'Haitian Creole':'ht',
  Portuguese: 'pt',
}

// WebClient insantiates a client that can call API methods
// When using Bolt, you can use either `app.client` or the `client` passed to listeners.
const client = new WebClient("xoxb-1596529540930-1596590839778-cBnZhlwQQHiPTK18v8NrjdBJ");
// ID of the channel you want to send the message to


function update_translations(language,table,fieldsToTranslate,hoursFieldsToTranslate,lastUpdatedName,view){
  let translateArr = [];
  let flagRecordArr = [];
  let flagStr = "";
  let filterStr = "OR(";
  fieldsToTranslate.forEach(field => {
    filterStr += "AND(NOT({" + field + "} = BLANK()),NOT(trim({" + field + "}) = \"\")),";
  });
  filterStr = filterStr.substring(0,filterStr.length-1);
  filterStr += ")"
  return new Promise((resolve, reject) => {
    base(table).select({
      maxRecords: config["maxRecords"],
      pageSize:100,
      filterByFormula: `and(search(\"${language}\",
      {Languages to Translate to}) > 0,
      or({Last Updated ${language}} = BLANK(),datetime_diff({${lastUpdatedName}},{Last Updated ${language}},\'s\') > 0),${filterStr})`
    }).eachPage(function page(records, fetchNextPage) {
      records.forEach(function(record) {
        // console.log(records);
        // console.log(record["Additional Notes"]);
        fieldsToTranslate.forEach(async (field) => {
          const text = typeof record.get(field) == 'undefined' ? "" : record.get(field).trim()
          if(text != ""){
            if(text.length < config["FPCmaxTranslateLength"]){
              translateArr.push({
                "id":record["id"],
                "field":field,
                "text":text
              })
            }
            else {
              // assuming that all tables will have an id field
              fs.appendFileSync('flag_log.csv',`${new Date()},${table},${record.get("id")}\n`);
              try {
                // Call the chat.postMessage method using the WebClient
                const result = await client.chat.postMessage({
                  channel: config["errorChannelID"],
                  text: `Automatic Translations \n${language} ${text.length}/${config["FPCmaxTranslateLength"]} https://airtable.com/${table}/${view}/${record["id"]}`,
                });

                console.log(result);
              }
              catch (error) {
                console.error(error);
              }
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
    console.log("ERROR: translate array is empty");
    return;
  }
  let text = [];
  let charCount = 0;
  let temp = [];
  let numCharsTranslated = 0;
  let numRecordsTranslated = 0;
  translateArr.forEach(element => {
    if((charCount + element["text"].length) > config["googleTranslateCharLimit"]){
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
  try {
    // Call the chat.postMessage method using the WebClient
    const result = await client.chat.postMessage({
      channel: config["successChannelID"],
      text: `Automatic Translations \n ${table} \n Records ${numRecordsTranslated} \n Chars ${numCharsTranslated}`,
    });

    console.log(result);
  }
  catch (error) {
    console.error(error);
  }
  text.push(temp);
  const target = langObj[language];
  let resultArr = [];
  //console.log(translateArr);
  for(var i = 0;i<text.length;i++){
    let arr = text[i];
    //console.log(text);
    let [translations] = await translate.translate(arr, target);
    translations = Array.isArray(translations) ? translations : [translations];

    translations.forEach(translation => {
      // // In order to bullet point in airtable, formatting needs to be "- " with the space
      // // Some entries lose the space on translation so this replaces first instance
      // if(translation.substring(0,2) != "- "){
      //   translation = "- " + translation.substring(1)
      // }
      // // Replaces any further instances where "- " formatting is not followed
      // translation = translation.replace(/\n-(\S)/g,'\n- $1')
      translation = fixFormatting(translation);
      resultArr.push(translation);
    });

  };
  build_update(translateArr,resultArr,language,table);
}

function fixFormatting(translation){
  // In order to bullet point in airtable, formatting needs to be "- " with the space
  // Some entries lose the space on translation so this replaces first instance
  if(translation.substring(0,2) != "- "){
    translation = "- " + translation.substring(1)
  }
  // Replaces any further instances where "- " formatting is not followed
  translation = translation.replace(/\n-(\S)/g,'\n- $1')
  translation = translation.replace(/[「」]/g,"\"")
  translation = translation.replace(/[“”]/g,"\"")
  console.log(translation);
  // Gets rid of spaces for url formatting between [Website] (www.website.com) into [Website](www.website.com) for markdown formatting
  const markdownURLRegex = /\[([\w\s\d]+)\]\s?\((https?:\/\/[\w\d\s.\/?=#]+)\)/g;
  let match = markdownURLRegex.exec(translation);
  let newMD = ''
  while (match != null) {
    // match[1] is the content within square brackets
    // match[2] is the url
    // newMD is the new markdown with the space between ] and ( stripped and the url stripped of any excess spaces
    newMD = "[" + match[1] + "](" + match[2].replace(/\s/g, '') + ")";
    translation = translation.replace(match[0],newMD);
    match = markdownURLRegex.exec(translation);
  }
  return translation;
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
    let allChunks = [];
    for (i=0;i<updateArr.length;i+= update_chunk_size) {
	temp= updateArr.slice(i,i+ update_chunk_size);
	allChunks.push(temp);
    }

    allChunks.forEach((chunk) => {
	base(table).update(chunk, function(err, records) {
	    if (err) {
		console.error(err);
		return;
	    };
	});
    })
    console.log("done " + table);
}
config["tables"].forEach(table => {
  table["languages"].forEach(language => {
      update_translations(language,table["tableID"],table["fieldsToTranslate"],[],table["lastUpdatedName"],table["viewID"]);
    });
});
