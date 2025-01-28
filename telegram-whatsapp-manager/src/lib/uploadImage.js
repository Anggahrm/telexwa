import FormData from 'form-data';
import { fileTypeFromBuffer } from 'file-type';
import fetch from 'node-fetch';

/**
 * Upload image to catbox.moe
 * Supported mimetype:
 * - `image/jpeg`
 * - `image/jpg`
 * - `image/png`
 * @param {Buffer} buffer Image Buffer
 */
export async function uploadImage(buffer) {
  const { ext } = await fileTypeFromBuffer(buffer);
  const bodyForm = new FormData();
  bodyForm.append("fileToUpload", buffer, "file." + ext);
  bodyForm.append("reqtype", "fileupload");

  try {
    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: bodyForm,
    });

    if (!res.ok) {
      throw new Error(`Failed to upload image: ${res.statusText}`);
    }

    const data = await res.text();
    return data;
  } catch (error) {
    throw error;
  }
}