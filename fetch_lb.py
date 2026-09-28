import urllib.request
import re
import json

req = urllib.request.Request(
    'https://letterboxd.com/Af_Sindbad/watchlist/',
    headers={'User-Agent': 'Mozilla/5.0'}
)
html = urllib.request.urlopen(req).read().decode('utf-8')

for match in re.finditer(r'data-postered-identifier=\'(.*?)\'', html):
    try:
        data = json.loads(match.group(1).replace('&quot;', '"'))
        print(data)
    except Exception as e:
        print(e)
        pass
