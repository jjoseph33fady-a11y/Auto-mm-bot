require("dotenv").config();
const bip39 = require('bip39');
const HDKey = require('hdkey');
const bitcore = require('bitcore-lib-ltc');

function getPrivateKey(seedPhrase, index) {
  const seed = bip39.mnemonicToSeedSync(seedPhrase);
  const hdkey = HDKey.fromMasterSeed(seed);
  const child = hdkey.derive(`m/44'/2'/0'/0/${index}`);
  const privateKey = new bitcore.PrivateKey(child.privateKey.toString('hex'));
  const address = privateKey.toAddress();
  console.log(`Index ${index}:`);
  console.log(`Address: ${address.toString()}`);
  console.log(`Private Key (WIF): ${privateKey.toWIF()}`);
  console.log('---');
}

// Prints first 5 indexes, add more if needed
for (let i = 0; i < 5; i++) {
  getPrivateKey(process.env.LTC_SEED_PHRASE, i);
}