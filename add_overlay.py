content = open('js/src/12_main.js').read()
target = '  // Interpolate remote player meshes toward server-reported positions'
if target not in content:
    print('ERROR: target string not found')
    import subprocess
    result = subprocess.run(['grep', '-n', 'Interpolate remote', 'js/src/12_main.js'], capture_output=True, text=True)
    print(result.stdout)
else:
    overlay = (
        '  // Debug overlay\n'
        '  let debugDiv = document.getElementById("mp-debug");\n'
        '  if (!debugDiv) {\n'
        '    debugDiv = document.createElement("div");\n'
        '    debugDiv.id = "mp-debug";\n'
        '    debugDiv.style.cssText = "position:fixed;top:10px;left:10px;color:#0f0;font:14px monospace;z-index:9999;pointer-events:none;background:rgba(0,0,0,0.5);padding:6px";\n'
        '    document.body.appendChild(debugDiv);\n'
        '  }\n'
        '  const ids = Object.keys(state.remotePlayers);\n'
        '  if (ids.length === 0) {\n'
        '    debugDiv.textContent = "Remote players: NONE";\n'
        '  } else {\n'
        '    debugDiv.textContent = ids.map(id => {\n'
        '      const rp = state.remotePlayers[id];\n'
        '      const dx = (rp.targetX||0) - camera.position.x;\n'
        '      const dz = (rp.targetZ||0) - camera.position.z;\n'
        '      const dist = Math.sqrt(dx*dx+dz*dz).toFixed(1);\n'
        '      return id + " dist:" + dist + "m y:" + (rp.targetY||0).toFixed(1);\n'
        '    }).join("\\n");\n'
        '  }\n'
        '\n'
        '  // Interpolate remote player meshes toward server-reported positions'
    )
    content = content.replace(target, overlay)
    open('js/src/12_main.js', 'w').write(content)
    print('Done')
