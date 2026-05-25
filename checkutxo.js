const axios = require('axios');

async function check() {
  const res = await axios.get('https://litecoinspace.org/api/address/LYzzM2NGcA7D8HWw4woKvWDgYyvkiu49W5/utxo');
  console.log(JSON.stringify(res.data, null, 2));
}

check();