content = open('server/server.js').read()

old = '''function stepPlayer(p, dt) {
  if (p.dead || !p.lastInput) return;

  const inp = p.lastInput;'''

new = '''function stepPlayer(p, dt) {
  if (p.dead || !p.lastInput) return;

  const inp = p.lastInput;

  // Trust client-reported position
  if (inp.x !== undefined) {
    p.x = inp.x;
    p.y = inp.y;
    p.z = inp.z;
    p.yaw = inp.yaw;
    p.pitch = inp.pitch;
    return;
  }'''

if old in content:
    content = content.replace(old, new)
    open('server/server.js', 'w').write(content)
    print('Done - server patched')
else:
    print('ERROR: target not found')
    # Print the actual function start so we can see what to match
    idx = content.find('function stepPlayer')
    print(repr(content[idx:idx+200]))
