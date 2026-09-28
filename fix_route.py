import re

with open('app/api/watchlist/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_block = """              // Enrich with Trakt/TMDb metadata if traktClient is available
              if (traktClient && (!tmdbId || !posterUrl)) {
                try {
                  const searchResults = await traktClient.searchMovie(filmTitle, it.filmYear);
                  if (searchResults && searchResults.length > 0) {
                    const matched = findBestMovieMatch(searchResults, filmTitle, it.filmYear);
                    if (matched) {
                      if (!tmdbId && matched.ids?.tmdb) tmdbId = matched.ids.tmdb;
                      if (matched.ids?.imdb) imdbId = matched.ids.imdb;
                      if (matched.overview) overview = matched.overview;
                      if (matched.rating) rating = Math.round(matched.rating * 10) / 10;
                      if (matched.genres) genres = matched.genres;

                      if (tmdbId && watchedTmdbIds.has(tmdbId)) {
                        continue;
                      }

                      if (!posterUrl && imdbId) {
                        posterUrl = `https://images.metahub.space/poster/medium/${imdbId}/img`;
                      }
                    }
                  }
                } catch {}
              }"""

new_block = """              // Enrich with Trakt/TMDb metadata if traktClient is available
              if (traktClient && (!tmdbId || !posterUrl || !overview)) {
                try {
                  let searchResults: any[] = [];
                  
                  // Optimize: If we extracted the TMDB ID from Letterboxd HTML, search precisely by ID instead of title!
                  if (tmdbId) {
                    const idResults = await traktClient.searchId(tmdbId.toString(), 'tmdb');
                    if (idResults && idResults.length > 0 && idResults[0].movie) {
                      searchResults = [{ ...idResults[0].movie, score: 1000 }];
                    }
                  }
                  
                  // Fallback to title search if TMDB ID search failed or we don't have one
                  if (searchResults.length === 0) {
                    searchResults = await traktClient.searchMovie(filmTitle, it.filmYear);
                  }

                  if (searchResults && searchResults.length > 0) {
                    const matched = tmdbId ? searchResults[0] : findBestMovieMatch(searchResults, filmTitle, it.filmYear);
                    if (matched) {
                      if (!tmdbId && matched.ids?.tmdb) tmdbId = matched.ids.tmdb;
                      if (matched.ids?.imdb) imdbId = matched.ids.imdb;
                      if (matched.overview) overview = matched.overview;
                      if (matched.rating) rating = Math.round(matched.rating * 10) / 10;
                      if (matched.genres) genres = matched.genres;

                      if (tmdbId && watchedTmdbIds.has(tmdbId)) {
                        continue;
                      }

                      if (!posterUrl && imdbId) {
                        posterUrl = `https://images.metahub.space/poster/medium/${imdbId}/img`;
                      }
                    }
                  }
                } catch {}
              }"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open('app/api/watchlist/route.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced route successfully!")
else:
    print("Could not find old block in route!")
