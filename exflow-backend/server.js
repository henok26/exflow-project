// 1. Import necessary libraries
const express = require('express');
const axios = require('axios');
const JSZip = require('jszip');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

// 2. Create an instance of an express app
const app = express();

// 3. Define the port the server will run on
const PORT = 3000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// 4. Define a basic route for the homepage
app.get('/', (req, res) => {
  res.send('Hello from the Exflow Backend! The server is running.');
});

// --- THE MAIN EXPORT ROUTE ---
app.post('/export', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).send({ error: 'URL is required' });
  }

  try {
    const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = response.data;
    const baseURL = new URL(url);

    const $ = cheerio.load(html);
    const zip = new JSZip();
    
    // Create folders for assets in the ZIP file
    const cssFolder = zip.folder('css');
    const jsFolder = zip.folder('js');
    const imagesFolder = zip.folder('images'); // New folder for images

    const assetPromises = [];

    // --- Process CSS files ---
    $('link[rel="stylesheet"]').each((index, element) => {
      const cssUrl = new URL($(element).attr('href'), baseURL.href).href;
      const cssFilename = path.basename(cssUrl).split('?')[0];
      $(element).attr('href', `./css/${cssFilename}`);
      
      const downloadPromise = axios.get(cssUrl, { responseType: 'arraybuffer' })
        .then(response => {
          console.log(`Downloaded CSS: ${cssFilename}`);
          cssFolder.file(cssFilename, response.data);
        })
        .catch(err => console.error(`Failed to download ${cssFilename}: ${err.message}`));
      assetPromises.push(downloadPromise);
    });
    
    // --- Process JS files ---
    $('script[src]').each((index, element) => {
      const jsUrl = new URL($(element).attr('src'), baseURL.href).href;
      const jsFilename = path.basename(jsUrl).split('?')[0];
      $(element).attr('src', `./js/${jsFilename}`);
      
      const downloadPromise = axios.get(jsUrl, { responseType: 'arraybuffer' })
        .then(response => {
          console.log(`Downloaded JS: ${jsFilename}`);
          jsFolder.file(jsFilename, response.data);
        })
        .catch(err => console.error(`Failed to download ${jsFilename}: ${err.message}`));
      assetPromises.push(downloadPromise);
    });

    // --- NEW: Process Image files ---
    $('img').each((index, element) => {
        let imageUrl = $(element).attr('src');
        if (!imageUrl) return; // Skip if there's no src attribute

        // A simple way to handle srcset: just use the first URL
        const srcset = $(element).attr('srcset');
        if (srcset) {
            imageUrl = srcset.split(',')[0].trim().split(' ')[0];
        }

        const absoluteImageUrl = new URL(imageUrl, baseURL.href).href;
        const imageFilename = path.basename(new URL(absoluteImageUrl).pathname);

        // Update the HTML to point to the new local path
        $(element).attr('src', `./images/${imageFilename}`);
        $(element).removeAttr('srcset'); // Remove srcset to avoid confusion

        const downloadPromise = axios.get(absoluteImageUrl, { responseType: 'arraybuffer' })
            .then(response => {
                console.log(`Downloaded Image: ${imageFilename}`);
                imagesFolder.file(imageFilename, response.data);
            })
            .catch(err => console.error(`Failed to download ${imageFilename}: ${err.message}`));
        assetPromises.push(downloadPromise);
    });

    // Wait for all assets to be downloaded
    await Promise.all(assetPromises);
    console.log('All assets have been processed.');
    
    // Add the modified HTML to the ZIP and send it
    const modifiedHtml = $.html();
    zip.file('index.html', modifiedHtml);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    console.log('Sending ZIP file to client.');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="website.zip"`);
    res.send(zipBuffer);

  } catch (error) {
    console.error('An error occurred:', error.message);
    res.status(500).send({ error: 'Failed to export the website. Please check the URL and try again.' });
  }
});

// 5. Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

