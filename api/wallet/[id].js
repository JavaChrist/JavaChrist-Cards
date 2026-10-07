import { handleWallet } from '../../server/wallet.js';

export default function handler(req, res) {
  return handleWallet(req, res, process.env);
}
