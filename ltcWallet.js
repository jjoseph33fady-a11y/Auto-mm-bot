const bip39 = require('bip39');
const HDKey = require('hdkey');
const bitcore = require('bitcore-lib-ltc');

function getLTCAddress(seedPhrase, index) {
  const seed = bip39.mnemonicToSeedSync(seedPhrase);
  const hdkey = HDKey.fromMasterSeed(seed);
  const child = hdkey.derive(`m/44'/2'/0'/0/${index}`);
  const privateKey = new bitcore.PrivateKey(child.privateKey.toString('hex'));
  const address = privateKey.toAddress();
  return address.toString();
}

module.exports = { getLTCAddress };