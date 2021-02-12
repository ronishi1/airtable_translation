const config = require("./config.json");
const fs = require('fs');
const { WebClient, LogLevel } = require("@slack/web-api");

const LanguageTranslatorV3 = require('ibm-watson/language-translator/v3');
const { IamAuthenticator } = require('ibm-watson/auth');

// version in generating IBM translation may need to be updated (read below)
// https://cloud.ibm.com/apidocs/language-translator?code=node#versioning
const languageTranslator = new LanguageTranslatorV3({
  version: '2021-02-06',
  authenticator: new IamAuthenticator({
    apikey: config["apiKeyIBM"],
  }),
  serviceUrl: 'https://api.us-south.language-translator.watson.cloud.ibm.com',
});

var Airtable = require('airtable');
var async = require('async');
var base = new Airtable({apiKey: config["apiKeyAirtable"]}).base(config["baseURL"]);
process.env.GOOGLE_APPLICATION_CREDENTIALS=config["pathToGoogleFile"];
const {Translate} = require('@google-cloud/translate').v2;
const translate = new Translate({projectId:'project-id-here'});

const update_chunk_size = 10;

// IBM DOES NOT SUPPORT TRANSLATION INTO HAITIAN CREOLE
const langObj = {
  Spanish: 'es',
  Chinese: 'zh',
  'Haitian Creole':'ht',
  Portuguese: 'pt',
}

const unsupportedIBM = ['Haitian Creole']

// WebClient insantiates a client that can call API methods
// When using Bolt, you can use either `app.client` or the `client` passed to listeners.
const client = new WebClient(config["slackAuth"]);
// ID of the channel you want to send the message to

function update_translations(language,table,countID){
  let translateArr = [];
  let flagRecordArr = [];
  let flagStr = "";
  let filterStr = "OR(";
  table["fieldsToTranslate"].forEach(field => {
    filterStr += "AND(NOT({" + field + "} = BLANK()),NOT(trim({" + field + "}) = \"\")),";
  });
  filterStr = filterStr.substring(0,filterStr.length-1);
  filterStr += ")"
  return new Promise((resolve, reject) => {
    base(table["tableID"]).select({
      maxRecords: table["maxRecords"],
      pageSize:100,
      // ARRAYJOIN is used to convert the lookup column into a string so that we can search
      // airtable has some difference between a list and lookup lists that prevents search from working properly
      filterByFormula: `and(search(\"${language}\",
      ARRAYJOIN({languages})) > 0,
      or({Last Updated ${language}} = BLANK(),datetime_diff({${table["lastUpdatedName"]}},{Last Updated ${language}},\'s\') > 0),${filterStr})`
    }).eachPage(function page(records, fetchNextPage) {
      records.forEach(function(record) {
        // console.log(record.get("languages"))
        // console.log(record["Additional Notes"]);
        table["fieldsToTranslate"].forEach(async (field) => {
          const text = typeof record.get(field) == 'undefined' ? "" : record.get(field).trim()
          if(text != ""){
            if(text.length < table["FPCmaxTranslateLength"]){
              translateArr.push({
                "id":record["id"],
                "field":field,
                "text":text
              })
            }

            else {
              // assuming that all tables will have an id field
              if(record.get(config["overrideName"])){
                translateArr.push({
                  "id":record["id"],
                  "field":field,
                  "text":text
                });
              }
              else {
                fs.appendFileSync('flag_log.csv',`${new Date()},${table},${record.get("id")}\n`);
                try {
                  // Call the chat.postMessage method using the WebClient
                  const result = await client.chat.postMessage({
                    channel: config["errorChannelID"],
                    text: `Automatic Translations \n${table["name"]}\n${language} ${text.length}/${table["FPCmaxTranslateLength"]} https://airtable.com/${table["tableID"]}/${table["viewID"]}/${record["id"]}`,
                  });
                }
                catch (error) {
                  console.error(error);
                }
              }
            }
          }
        })

      });

      fetchNextPage();

    }, async function done(err) {
      // add in check for unsupported languages & character limit to decide whether to use ibm or google
      const monthNames = ["January", "February", "March", "April", "May", "June","July", "August", "September", "October", "November", "December"];
      let date = new Date();
      const formattedDate = date.getFullYear() + " " + monthNames[date.getMonth()];
      let sumGoogle = 0;
      let sumIBM = 0;
      base(config["countTableID"]).select({
        filterByFormula:`{month}=\"${formattedDate}\"`
      }).eachPage(function page(records, fetchNextPage) {

          records.forEach(function(record) {
              if(record.get(config["translation source"]) == "IBM"){
                sumIBM += record.get("number of characters translated");
              }
              else {
                sumGoogle += record.get("number of characters translated");
              }
          });

          fetchNextPage();

      }, async function done(err) {
          // console.log("IBM: " + sumIBM);
          // console.log("GOOGLE: " + sumGoogle);
          // googleMonthlyCutoff is the percentage of google's maximum character limit to translate to
          if(sumGoogle > 500000 * config["googleMonthlyCutoff"] && !(unsupportedIBM.includes(language))){
            await translate_text_ibm(translateArr,language,table["tableID"],table["name"],countID)
          }
          else {
            await translate_text_google(translateArr,language,table["tableID"],table["name"],countID)
          }
          if (err) { console.error(err); return; }
      });
      resolve();
      if (err) { console.error(err); return; }
    });
  })
}

// IBM WATSON TRANSLATION CHAR LIMIT IS ABOUT 12800 CHARACTERS
// Input text in UTF-8 encoding. Submit a maximum of 50 KB (51,200 bytes) of text with a single request. Multiple elements result in multiple translations in the response
async function translate_text_ibm(translateArr,language,table,name,countID){
  if (translateArr.length == 0){
    console.log("ERROR: translate array is empty");
    fs.appendFileSync('log.csv',`${new Date()},${table},0,0\n`);
    const result = await client.chat.postMessage({
      channel: config["successChannelID"],
      text: `Automatic Translations \n ${name}\n ${language}\n Total Records Translated 0 \n Total Characters Translated 0`,
    });
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
      text: `Automatic Translations \n ${name}\n ${language}\nIBM \nTotal Records Translated ${numRecordsTranslated} \n Total Characters Translated ${numCharsTranslated}`,
    });
    const date = new Date();
    base(countID).create({
      name:name,
      date:new Date(),
      "number of characters translated":numCharsTranslated,
      "language":language,
      "number of records":numRecordsTranslated,
      "translation source":"IBM"
    }, function(err, records) {
  	    if (err) {
  		console.error(err);
  		return;
  	    };
  	});
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

    const translateParams = {
      text: arr,
      source:'en',
      target:target
    };

    await languageTranslator.translate(translateParams)
      .then(translationResult => {
        console.log(translationResult.result)
        translationResult.result.translations.forEach(translation => {
          translation = fixFormatting(translation.translation);
          resultArr.push(translation);
        });
        console.log(resultArr)
      })
      .catch(err => {
        console.log('error:', err);
      });


  };
  build_update(translateArr,resultArr,language,table);
}

async function translate_text_google(translateArr,language,table,name,countID){
  if (translateArr.length == 0){
    console.log("ERROR: translate array is empty");
    fs.appendFileSync('log.csv',`${new Date()},${table},0,0\n`);
    const result = await client.chat.postMessage({
      channel: config["successChannelID"],
      text: `Automatic Translations \n ${name}\n ${language}\nTotal Records Translated 0 \n Total Characters Translated 0`,
    });
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
      text: `Automatic Translations \n ${name}\n ${language}\nGoogle \nTotal Records Translated ${numRecordsTranslated} \n Total Characters Translated ${numCharsTranslated}`,
    });
    const date = new Date();
    base(countID).create({
      name:name,
      date:new Date(),
      "number of characters translated":numCharsTranslated,
      "language":language,
      "number of records":numRecordsTranslated,
      "translation source":"Google"
    }, function(err, records) {
  	    if (err) {
  		console.error(err);
  		return;
  	    };
  	});
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
  // Gets rid of spaces for url formatting between [Website] (www.website.com) into [Website](www.website.com) for markdown formatting
  const markdownURLRegex = /\[([\w\s\d]+)\]\s?\((https?:\/\/[^\)]*)\)/g;
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
      updateObj["fields"][config["overrideName"]] = false;
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
      update_translations(language,table,config["countTableID"]);

    });
});
