import re

with open('app/api/activity/24h/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

bad_history_loop = """      for (const h of history) {
        if (!h.watched_at) continue;
        const watchDate = new Date(h.watched_at);
        if (watchDate >= cutoffTime) {
          const showTitleLower = h.show.title.toLowerCase();"""

good_history_loop = """      for (const h of history) {
        if (!h.watched_at) continue;
        
        // Only include actual anime in the MAL feed!
        const genres = h.show.genres || [];
        const isAnime = genres.includes("anime") || genres.includes("animation");
        if (!isAnime) continue;

        const watchDate = new Date(h.watched_at);
        if (watchDate >= cutoffTime) {
          const showTitleLower = h.show.title.toLowerCase();"""

if bad_history_loop in content:
    content = content.replace(bad_history_loop, good_history_loop)
    with open('app/api/activity/24h/route.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed Activity Feed anime filtering!")
else:
    print("Could not find Activity Feed history loop!")
