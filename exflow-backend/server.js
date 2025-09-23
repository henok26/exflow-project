// 1. Import necessary libraries
const express = require('express');
const axios = require('axios');
const JSZip = require('jszip');
const cors = require('cors'); // Import the cors package
const cheerio = require('cheerio'); // To parse HTML
const path = require('path'); // To handle file paths
const { URL } = require('url'); // To resolve relative URLs

// 2. Create an instance of an express app
const app = express();

// 3. Define the port the server will run on
const PORT = 3000;

// --- MIDDLEWARE ---
// Use CORS to allow cross-origin requests from your frontend
app.use(cors());
// This line allows your server to understand JSON sent from the frontend
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

    // Step 1: Load HTML into Cheerio to parse it
    const $ = cheerio.load(html);
    const zip = new JSZip();
    
    // Create folders for assets in the ZIP file
    const cssFolder = zip.folder('css');
    const jsFolder = zip.folder('js');

    const assetPromises = []; // We'll store all our download promises here

    // Step 2: Find, download, and update CSS files
    $('link[rel="stylesheet"]').each((index, element) => {
      const cssUrl = new URL($(element).attr('href'), baseURL.href).href;
      const cssFilename = path.basename(cssUrl).split('?')[0]; // Get a clean filename
      
      // Update the HTML to point to the local file
      $(element).attr('href', `./css/${cssFilename}`);
      
      // Create a promise to download the CSS file
      const downloadPromise = axios.get(cssUrl, { responseType: 'arraybuffer' })
        .then(response => {
          console.log(`Downloaded CSS: ${cssFilename}`);
          cssFolder.file(cssFilename, response.data);
        })
        .catch(err => console.error(`Failed to download ${cssFilename}: ${err.message}`));
        
      assetPromises.push(downloadPromise);
    });
    
    // Step 3: Find, download, and update JS files
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

    // Step 4: Wait for all assets to be downloaded
    await Promise.all(assetPromises);
    console.log('All assets have been processed.');
    
    // Step 5: Add the modified HTML to the ZIP
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


// 6. Start the server and make it listen for requests
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

