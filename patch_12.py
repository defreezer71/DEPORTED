import re

content = open('js/src/12_main.js').read()

old = (
    "      case 'world':\n"
    "        state.lastServerTick = msg.tick;\n"
    "        console.log('WORLD tick', msg.tick, 'players:', msg.players.map(p => p.id + '(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(1) + ')').join(' | '));\n"
    "        updateRemotePlayers(msg.players);\n"
    "        break;"
)

new = (
    "      case 'world':\n"
    "        state.lastServerTick = msg.tick;\n"
    "        console.log('WORLD tick', msg.tick, 'players:', msg.players.map(p => p.id + '(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(1) + ')').join(' | '));\n"
    "        updateRemotePlayers(msg.players);\n"
    "        if (msg.events && msg.events.length) {\n"
    "          for (const evt of msg.events) {\n"
    "            if (evt.type === 'hit') applyHitEvent(evt);\n"
    "          }\n"
    "        }\n"
    "        break;"
)

if 'applyHitEvent' in content:
    print('ALREADY PRESENT — skipping')
elif old in content:
    content = content.replace(old, new)
    open('js/src/12_main.js', 'w').write(content)
    print('Done')
else:
    print('ERROR: anchor not found')
