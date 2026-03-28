content = open('js/src/11_gameplay.js').read()

helpers = (
    "// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n"
    "// REMOTE PLAYER HIT DETECTION\n"
    "// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n"
    "\n"
    "// Collect all live remote player sub-meshes for the raycast\n"
    "function getRemotePlayerMeshes() {\n"
    "  const meshes = [];\n"
    "  for (const rp of Object.values(state.remotePlayers || {})) {\n"
    "    if (rp.mesh && !rp.dead) {\n"
    "      rp.mesh.traverse(child => { if (child.isMesh) meshes.push(child); });\n"
    "    }\n"
    "  }\n"
    "  return meshes;\n"
    "}\n"
    "\n"
    "// Walk up parent chain to find which remote player owns a hit mesh\n"
    "function findRemotePlayerByPart(obj) {\n"
    "  for (const [id, rp] of Object.entries(state.remotePlayers || {})) {\n"
    "    if (!rp.mesh || rp.dead) continue;\n"
    "    let cur = obj;\n"
    "    while (cur) {\n"
    "      if (cur === rp.mesh) return { id, rp };\n"
    "      cur = cur.parent;\n"
    "    }\n"
    "  }\n"
    "  return null;\n"
    "}\n"
    "\n"
    "// Called by 12_main.js when a hit event arrives in a world snapshot\n"
    "function applyHitEvent(evt) {\n"
    "  const rp = (state.remotePlayers || {})[evt.target];\n"
    "  if (!rp) return;\n"
    "  if (evt.targetHp !== undefined) rp.hp = evt.targetHp;\n"
    "  else rp.hp = Math.max(0, (rp.hp !== undefined ? rp.hp : 100) - evt.damage);\n"
    "  if (evt.targetDead || rp.hp <= 0) {\n"
    "    rp.dead = true;\n"
    "    if (rp.mesh) rp.mesh.visible = false;\n"
    "  }\n"
    "}\n"
    "\n"
    "// Fire-and-forget shoot message to server\n"
    "function sendShoot(targetId, damage, headshot) {\n"
    "  const sock = (state && state.ws) ? state.ws : (typeof ws !== 'undefined' ? ws : null);\n"
    "  if (sock && sock.readyState === 1) {\n"
    "    sock.send(JSON.stringify({ type: 'shoot', targetId, damage, headshot }));\n"
    "  }\n"
    "}\n"
    "\n"
)

anchor = '// SHOOTING \u2014 First shot accurate, spread accumulates with rapid fire'

if 'function getRemotePlayerMeshes' in content:
    print('ALREADY PRESENT \u2014 skipping')
elif anchor not in content:
    print('ERROR: anchor not found \u2014 check file')
else:
    content = content.replace(anchor, helpers + anchor)
    open('js/src/11_gameplay.js', 'w').write(content)
    print('Done')
