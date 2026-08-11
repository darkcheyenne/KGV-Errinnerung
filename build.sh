AEBHASH=$(git rev-parse --short HEAD)
docker build -t darkcheyenne/kgv-errinnerung:$AEBHASH .