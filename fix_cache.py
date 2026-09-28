import re

with open('lib/clients/trakt.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(
    r'headers:\s*this\.getHeaders\(\),\n\s*\}',
    'headers: this.getHeaders(),\n      cache: "no-store",\n    }',
    content
)

with open('lib/clients/trakt.ts', 'w', encoding='utf-8') as f:
    f.write(content)
