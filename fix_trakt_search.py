import re

with open('lib/clients/trakt.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add searchId method before searchMovie
search_movie_def = """  async searchMovie("""

search_id_def = """  async searchId(id: string, idType: 'tmdb' | 'imdb' | 'trakt', type: 'movie' | 'show' = 'movie'): Promise<any[]> {
    const endpoint = `https://api.trakt.tv/search/${idType}/${id}?type=${type}&extended=full`;
    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      console.warn(`Trakt searchId failed (${res.status}) for ${idType}:${id}`);
      return [];
    }
    return res.json();
  }

  async searchMovie("""

if search_movie_def in content:
    content = content.replace(search_movie_def, search_id_def)
    with open('lib/clients/trakt.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Added searchId successfully!")
else:
    print("Could not find searchMovie def!")
