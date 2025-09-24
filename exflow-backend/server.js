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

// --- Usage Tracking ---
let exportCount = 0;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// 4. Define a basic route for the homepage
app.get('/', (req, res) => {
  res.send('Hello from the Exflow Backend! The server is running.');
});

// --- NEW: Stats Route ---
// You can visit this endpoint to see the current usage stats
app.get('/stats', (req, res) => {
    res.json({
        totalExportsInitiated: exportCount,
        serverUptimeInSeconds: Math.floor(process.uptime())
    });
});


// Helper function to create a clean file path from a URL (e.g., /about -> about/index.html)
const getHtmlFilePath = (pageUrl, baseUrl) => {
    const urlObj = new URL(pageUrl);
    let pathname = urlObj.pathname;

    if (pathname === '/') return 'index.html';

    let cleanPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    cleanPath = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;

    return `${cleanPath}/index.html`;
};

// --- THE MAIN EXPORT ROUTE ---
app.post('/export', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).send({ error: 'URL is required' });
    }

    try {
        // Increment the counter and log it
        exportCount++;
        console.log(`Export #${exportCount} initiated for URL: ${url}`);

        const zip = new JSZip();
        const visitedUrls = new Set();
        const queue = [new URL(url).href]; // Use a queue to manage pages to crawl
        const baseURL = new URL(url);

        const cssFolder = zip.folder('css');
        const jsFolder = zip.folder('js');
        const imagesFolder = zip.folder('images');
        
        const downloadedAssets = new Set(); // To avoid re-downloading the same asset
        const imageUrlRegex = /url\((['"]?)(.*?)\1\)/g;

        while (queue.length > 0) {
            const currentUrl = queue.shift();
            if (visitedUrls.has(currentUrl)) continue;
            
            visitedUrls.add(currentUrl);
            console.log(`Processing: ${currentUrl}`);

            try {
                const response = await axios.get(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const html = response.data;
                const $ = cheerio.load(html);
                const assetPromises = [];

                // --- Process CSS files ---
                $('link[rel="stylesheet"]').each((index, element) => {
                    const cssUrlHref = $(element).attr('href');
                    if (!cssUrlHref) return;

                    const absoluteCssUrl = new URL(cssUrlHref, currentUrl).href;
                    const cssFilename = path.basename(new URL(absoluteCssUrl).pathname).split('?')[0];
                    $(element).attr('href', path.relative(path.dirname(getHtmlFilePath(currentUrl)), `css/${cssFilename}`).replace(/\\/g, '/'));
                    
                    if (downloadedAssets.has(absoluteCssUrl)) return;
                    downloadedAssets.add(absoluteCssUrl);

                    const downloadPromise = axios.get(absoluteCssUrl, { responseType: 'text' })
                        .then(async (response) => {
                          let cssContent = response.data;
                          let match;
                          while ((match = imageUrlRegex.exec(cssContent)) !== null) {
                            const imageUrl = match[2];
                            if (imageUrl.startsWith('data:')) continue;
                            const absoluteImageUrl = new URL(imageUrl, absoluteCssUrl).href;
                            const imageFilename = path.basename(new URL(absoluteImageUrl).pathname);
                            cssContent = cssContent.replace(imageUrl, `../images/${imageFilename}`);
                            if (downloadedAssets.has(absoluteImageUrl)) continue;
                            downloadedAssets.add(absoluteImageUrl);
                            axios.get(absoluteImageUrl, { responseType: 'arraybuffer' }).then(imageResponse => {
                                imagesFolder.file(imageFilename, imageResponse.data);
                            }).catch(err => console.error(`Failed to download background image ${imageFilename}: ${err.message}`));
                          }
                          cssFolder.file(cssFilename, cssContent);
                        }).catch(err => console.error(`Failed to download ${cssFilename}: ${err.message}`));
                    assetPromises.push(downloadPromise);
                });
                
                // --- Process JS files ---
                $('script[src]').each((index, element) => {
                    const jsUrlHref = $(element).attr('src');
                    if (!jsUrlHref) return;
                    const absoluteJsUrl = new URL(jsUrlHref, currentUrl).href;
                    const jsFilename = path.basename(new URL(absoluteJsUrl).pathname).split('?')[0];
                    $(element).attr('href', path.relative(path.dirname(getHtmlFilePath(currentUrl)), `js/${jsFilename}`).replace(/\\/g, '/'));
                    if (downloadedAssets.has(absoluteJsUrl)) return;
                    downloadedAssets.add(absoluteJsUrl);
                    const downloadPromise = axios.get(absoluteJsUrl, { responseType: 'arraybuffer' }).then(response => {
                        jsFolder.file(jsFilename, response.data);
                    }).catch(err => console.error(`Failed to download ${jsFilename}: ${err.message}`));
                    assetPromises.push(downloadPromise);
                });

                // --- Process Image files from <img> tags ---
                $('img').each((index, element) => {
                    let imageUrl = $(element).attr('src');
                    if (!imageUrl || imageUrl.startsWith('data:')) return;
                    const srcset = $(element).attr('srcset');
                    if (srcset) {
                        imageUrl = srcset.split(',')[0].trim().split(' ')[0];
                    }
                    const absoluteImageUrl = new URL(imageUrl, currentUrl).href;
                    const imageFilename = path.basename(new URL(absoluteImageUrl).pathname);
                    $(element).attr('src', path.relative(path.dirname(getHtmlFilePath(currentUrl)), `images/${imageFilename}`).replace(/\\/g, '/'));
                    $(element).removeAttr('srcset');
                    if (downloadedAssets.has(absoluteImageUrl)) return;
                    downloadedAssets.add(absoluteImageUrl);
                    const downloadPromise = axios.get(absoluteImageUrl, { responseType: 'arraybuffer' }).then(response => {
                        imagesFolder.file(imageFilename, response.data);
                    }).catch(err => console.error(`Failed to download ${imageFilename}: ${err.message}`));
                    assetPromises.push(downloadPromise);
                });

                // --- NEW: Process images from inline <style> tags ---
                $('style').each((index, element) => {
                    let styleContent = $(element).html();
                    let match;
                    while ((match = imageUrlRegex.exec(styleContent)) !== null) {
                        const imageUrl = match[2];
                        if (imageUrl.startsWith('data:')) continue;
                        const absoluteImageUrl = new URL(imageUrl, currentUrl).href;
                        const imageFilename = path.basename(new URL(absoluteImageUrl).pathname);
                        styleContent = styleContent.replace(imageUrl, path.relative(path.dirname(getHtmlFilePath(currentUrl)), `images/${imageFilename}`).replace(/\\/g, '/'));
                        if (downloadedAssets.has(absoluteImageUrl)) continue;
                        downloadedAssets.add(absoluteImageUrl);
                        axios.get(absoluteImageUrl, { responseType: 'arraybuffer' }).then(response => {
                            imagesFolder.file(imageFilename, response.data);
                        }).catch(err => console.error(`Failed to download inline style image ${imageFilename}: ${err.message}`));
                    }
                    $(element).html(styleContent);
                });

                // --- NEW: Process images from inline style attributes ---
                $('[style*="background-image"]').each((index, element) => {
                    let styleAttribute = $(element).attr('style');
                    let match;
                    while ((match = imageUrlRegex.exec(styleAttribute)) !== null) {
                        const imageUrl = match[2];
                        if (imageUrl.startsWith('data:')) continue;
                        const absoluteImageUrl = new URL(imageUrl, currentUrl).href;
                        const imageFilename = path.basename(new URL(absoluteImageUrl).pathname);
                        styleAttribute = styleAttribute.replace(imageUrl, path.relative(path.dirname(getHtmlFilePath(currentUrl)), `images/${imageFilename}`).replace(/\\/g, '/'));
                        if (downloadedAssets.has(absoluteImageUrl)) continue;
                        downloadedAssets.add(absoluteImageUrl);
                        axios.get(absoluteImageUrl, { responseType: 'arraybuffer' }).then(response => {
                            imagesFolder.file(imageFilename, response.data);
                        }).catch(err => console.error(`Failed to download style attribute image ${imageFilename}: ${err.message}`));
                    }
                    $(element).attr('style', styleAttribute);
                });

                // --- Find and queue internal links for crawling ---
                $('a').each((index, element) => {
                    const linkHref = $(element).attr('href');
                    if (!linkHref) return;
                    const absoluteLink = new URL(linkHref, currentUrl).href.split('#')[0];
                    if (absoluteLink.startsWith(baseURL.origin)) {
                        if (!visitedUrls.has(absoluteLink) && !queue.includes(absoluteLink)) {
                            queue.push(absoluteLink);
                        }
                        const targetPath = getHtmlFilePath(absoluteLink);
                        const currentPath = getHtmlFilePath(currentUrl);
                        const relativePath = path.relative(path.dirname(currentPath), targetPath).replace(/\\/g, '/');
                        $(element).attr('href', relativePath || '.');
                    }
                });

                await Promise.all(assetPromises);
                const filePath = getHtmlFilePath(currentUrl);
                zip.file(filePath, $.html());

            } catch (pageError) {
                console.error(`Skipping ${currentUrl} due to error: ${pageError.message}`);
            }
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
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

