content = open('js/src/11_gameplay.js').read()

if 'remoteTargets' in content:
    print('ALREADY PRESENT — skipping')
else:
    old = 'const intersects = raycaster.intersectObjects(targets, false);'
    new = 'const remoteTargets = getRemotePlayerMeshes();\n  const intersects = raycaster.intersectObjects([...targets, ...remoteTargets], false);'
    if old in content:
        content = content.replace(old, new)
        open('js/src/11_gameplay.js', 'w').write(content)
        print('Done')
    else:
        print('ERROR: anchor not found')
