content = open('server/server.js').read()

if 'case "shoot"' in content:
    print('ALREADY PRESENT — skipping')
else:
    old = '    default:\n      // Unknown message — ignore'
    new = (
        '    case "shoot": {\n'
        '      const shooter = players.get(ws._playerId);\n'
        '      if (!shooter || shooter.dead) return;\n'
        '\n'
        '      const target = players.get(msg.targetId);\n'
        '      if (!target || target.dead) return;\n'
        '\n'
        '      // Range validation — server positions are authoritative\n'
        '      const dx = target.x - shooter.x;\n'
        '      const dz = target.z - shooter.z;\n'
        '      const dist = Math.sqrt(dx * dx + dz * dz);\n'
        '      if (dist > 600) {\n'
        '        console.warn("[cheat?] " + shooter.name + " shot " + dist.toFixed(1) + "m away");\n'
        '        return;\n'
        '      }\n'
        '\n'
        '      // Clamp damage to max possible weapon value (150 headshot + buffer)\n'
        '      const damage = Math.min(Math.max(Number(msg.damage) || 0, 0), 200);\n'
        '      const headshot = !!msg.headshot;\n'
        '\n'
        '      // Armor absorbs damage first; overflow goes to hp\n'
        '      if (target.armor > 0) {\n'
        '        const absorbed = Math.min(target.armor, damage);\n'
        '        target.armor -= absorbed;\n'
        '        target.hp = Math.max(0, target.hp - (damage - absorbed));\n'
        '      } else {\n'
        '        target.hp = Math.max(0, target.hp - damage);\n'
        '      }\n'
        '\n'
        '      if (target.hp <= 0) {\n'
        '        target.dead = true;\n'
        '        console.log("[kill] " + shooter.name + " killed " + target.name + " (hs:" + headshot + ")");\n'
        '      }\n'
        '\n'
        '      events.push({\n'
        '        type:        "hit",\n'
        '        shooter:     shooter.id,\n'
        '        target:      target.id,\n'
        '        damage,\n'
        '        headshot,\n'
        '        targetHp:    target.hp,\n'
        '        targetArmor: target.armor,\n'
        '        targetDead:  target.dead,\n'
        '      });\n'
        '      break;\n'
        '    }\n'
        '\n'
        '    default:\n'
        '      // Unknown message — ignore'
    )
    if old in content:
        content = content.replace(old, new)
        open('server/server.js', 'w').write(content)
        print('Done')
    else:
        print('ERROR: anchor not found')
