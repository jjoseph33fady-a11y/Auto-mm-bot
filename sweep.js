require("dotenv").config();
const bip39 = require('bip39');
const HDKey = require('hdkey');
const bitcore = require('bitcore-lib-ltc');
const axios = require('axios');

async function sweep(index, toAddress) {
  const seed = bip39.mnemonicToSeedSync(process.env.LTC_SEED_PHRASE);
  const hdkey = HDKey.fromMasterSeed(seed);
  const child = hdkey.derive(`m/44'/2'/0'/0/${index}`);
  const privateKey = new bitcore.PrivateKey(child.privateKey.toString('hex'));
  const fromAddress = privateKey.toAddress().toString();

  console.log(`Sweeping from: ${fromAddress}`);

  // Get UTXOs
  const res = await axios.get(`https://litecoinspace.org/api/address/${fromAddress}/utxo`);
  const utxos = res.data;

  if (!utxos || utxos.length === 0) {
    console.log('No UTXOs found');
    return;
  }

  console.log(`Found ${utxos.length} UTXO(s)`);

  const transaction = new bitcore.Transaction();

  for (const utxo of utxos) {
    transaction.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      address: fromAddress,
      script: bitcore.Script.fromAddress(fromAddress).toHex(),
      satoshis: utxo.value,
    });
  }

  transaction.to(toAddress, utxos.reduce((sum, u) => sum + u.value, 0) - 2000); // minus fee
  transaction.sign(privateKey);

  const raw = transaction.serialize();
  console.log('Broadcasting...');

  const broadcast = await axios.post('https://litecoinspace.org/api/tx', raw, {
    headers: { 'Content-Type': 'text/plain' },
  });

  console.log('Transaction ID:', broadcast.data);
}

// index 0 = first derived address, change if needed
// replace with your main Exodus LTC address
sweep(0, 'LXozTrtuyaChUtqypnbP8gLufRXFdn22K6');