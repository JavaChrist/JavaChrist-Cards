import { handleContact } from '../../server/contact.js';

export default function handler(req, res) {
  return handleContact(req, res, process.env);
}
