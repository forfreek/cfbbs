UPDATE federation_actors
SET shared_inbox_url = substr(uri, 1, instr(uri, '/users/') - 1) || '/inbox'
WHERE is_local = 1
  AND shared_inbox_url IS NULL
  AND instr(uri, '/users/') > 1;
