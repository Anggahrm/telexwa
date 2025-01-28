import fs from 'fs';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { fileTypeFromBuffer } from 'file-type';

const tempDir = './tmp';

if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

export async function writeExif(media, metadata) {
    const { data, mimetype } = media;
    const tmpFileIn = `${tempDir}/${Date.now()}.${mimetype.split('/')[1]}`;
    const tmpFileOut = `${tempDir}/${Date.now()}.webp`;
    
    fs.writeFileSync(tmpFileIn, data);

    if (mimetype.includes('image')) {
        await new Promise((resolve, reject) => {
            ffmpeg(tmpFileIn)
                .toFormat('webp')
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(tmpFileOut);
        });
    } else if (mimetype.includes('video')) {
        await new Promise((resolve, reject) => {
            ffmpeg(tmpFileIn)
                .toFormat('webp')
                .addOutputOptions([
                    '-vcodec', 'libwebp',
                    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse',
                    '-loop', '0',
                    '-ss', '00:00:00',
                    '-t', '00:00:10',
                    '-preset', 'default',
                    '-an',
                    '-vsync', '0'
                ])
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(tmpFileOut);
        });
    }

    const webpSticker = fs.readFileSync(tmpFileOut);
    fs.unlinkSync(tmpFileIn);
    fs.unlinkSync(tmpFileOut);
    
    return webpSticker;
}