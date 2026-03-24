content = open('js/src/12_main.js').read()

target = '  if (!state.playerDead) updateBots(renderDt);'

if target not in content:
    print('ERROR: target not found - check line 374')
else:
    addition = (
        '  if (!state.playerDead) updateBots(renderDt);\n'
        '\n'
        '  // Interpolate remote player meshes toward server-reported positions\n'
        '  for (const id in state.remotePlayers) {\n'
        '    const rp = state.remotePlayers[id];\n'
        '    if (rp.targetX === undefined) continue;\n'
        '    rp.mesh.position.x += (rp.targetX - rp.mesh.position.x) * Math.min(1, renderDt * 15);\n'
        '    rp.mesh.position.y += (rp.targetY - rp.mesh.position.y) * Math.min(1, renderDt * 15);\n'
        '    rp.mesh.position.z += (rp.targetZ - rp.mesh.position.z) * Math.min(1, renderDt * 15);\n'
        '  }\n'
        '\n'
        '  // Debug overlay - remote player distances\n'
        '  let debugDiv = document.getElementById("mp-debug");\n'
        '  if (!debugDiv) {\n'
        '    debugDiv = document.createElement("div");\n'
        '    debugDiv.id = "mp-debug";\n'
        '    debugDiv.style.cssText = "position:fixed;top:10px;left:10px;color:#0f0;font:14px monospace;z-index:9999;pointer-events:none;background:rgba(0,0,0,0.5);padding:6px";\n'
        '    document.body.appendChild(debugDiv);\n'
        '  }\n'
        '  const rids = Object.keys(state.remotePlayers);\n'
        '  if (rids.length === 0) {\n'
        '    debugDiv.textContent = "Remote players: NONE";\n'
        '  } else {\n'
        '    debugDiv.textContent = rids.map(id => {\n'
        '      const rp = state.remotePlayers[id];\n'
        '      const dx = (rp.targetX||0) - camera.position.x;\n'
        '      const dz = (rp.targetZ||0) - camera.position.z;\n'
        '      const dist = Math.sqrt(dx*dx+dz*dz).toFixed(1);\n'
        '      return id + " dist:" + dist + "m y:" + (rp.targetY||0).toFixed(1);\n'
        '    }).join("\\n");\n'
        '  }'
    )
    content = content.replace(target, addition)
    open('js/src/12_main.js', 'w').write(content)
    print('Done')
