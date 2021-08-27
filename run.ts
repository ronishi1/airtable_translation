const axios = require('axios');
const Translator = require("./update_translations.ts")
const config = require("./config.json");
let t = new Translator(config);
t.executeTranslation();
axios.get('https://hc-ping.com/5864484b-db6d-40af-9513-252d94f0aeec');
