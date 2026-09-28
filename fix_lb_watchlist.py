import re

with open('lib/clients/letterboxd.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to replace the itemRegex logic in fetchUserWatchlistRss
old_logic = """    const items: LetterboxdRssItem[] = [];
    const itemRegex = /data-item-name="([^"]+)"\\s+data-item-slug="([^"]+)"\\s+data-item-link="([^"]+)"/g;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const rawName = decodeHtmlEntities(match[1]);
      const slug = match[2];
      const link = match[3];

      // Parse title and year: "Master (2021)" or "District 9 (2009)"
      const nameMatch = rawName.match(/^(.*?)(?:\\s+\\((\\d{4})\\))?$/);
      const title = nameMatch ? nameMatch[1].trim() : rawName;
      const year = nameMatch && nameMatch[2] ? parseInt(nameMatch[2], 10) : undefined;

      items.push({
        title: rawName,
        filmTitle: title,
        filmYear: year,
        reviewLink: `https://letterboxd.com${link}`,
        guid: slug,
      });
    }"""

new_logic = """    const items: LetterboxdRssItem[] = [];
    
    // Improved regex to capture data-item-name, slug, link, and optionally the postered-identifier JSON for tmdbId
    const itemRegex = /data-item-name="([^"]+)"\\s+data-item-slug="([^"]+)"\\s+data-item-link="([^"]+)".*?(?:data-postered-identifier='([^']+)')?/g;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const rawName = decodeHtmlEntities(match[1]);
      const slug = match[2];
      const link = match[3];
      const identifierJsonStr = match[4]; // e.g. {&quot;uid&quot;:&quot;film:853733&quot;...}

      // Parse title and year: "Master (2021)" or "District 9 (2009)"
      const nameMatch = rawName.match(/^(.*?)(?:\\s+\\((\\d{4})\\))?$/);
      const title = nameMatch ? nameMatch[1].trim() : rawName;
      const year = nameMatch && nameMatch[2] ? parseInt(nameMatch[2], 10) : undefined;

      let tmdbId: number | undefined = undefined;
      if (identifierJsonStr) {
        try {
          const decodedJsonStr = identifierJsonStr.replace(/&quot;/g, '"');
          const identifier = JSON.parse(decodedJsonStr);
          if (identifier && identifier.uid && identifier.uid.startsWith('film:')) {
            tmdbId = parseInt(identifier.uid.replace('film:', ''), 10);
          }
        } catch (e) {
          console.warn("Failed to parse letterboxd postered-identifier", e);
        }
      }

      items.push({
        title: rawName,
        filmTitle: title,
        filmYear: year,
        reviewLink: `https://letterboxd.com${link}`,
        guid: slug,
        tmdbId,
      });
    }"""

if old_logic in content:
    content = content.replace(old_logic, new_logic)
    with open('lib/clients/letterboxd.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced successfully!")
else:
    print("Could not find old logic!")
