from subprocess import check_output

'''
' Create a sparkline chart
'''
def sparkle(filename,value,count=10):
	data = ""
	try:
		with open(filename, "r") as myfile:
			data = myfile.read()
	except:
		pass

	data = data.rstrip().split(" ")
	if len(data)>=count:
		data.reverse()
		data.pop()
		data.reverse()
	data.append(value)
	data = " ".join(data)

	with open(filename, "w") as myfile:
		myfile.write(data)

	spark=check_output("~/.dotfiles/bin/spark %s" % data, shell=True)
	return spark.decode()


'''
' Converts bytes counters to human readable form
'''
def b2h(n):
	symbols = ('K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y')
	prefix = {}
	for i, s in enumerate(symbols):
		prefix[s] = 1 << (i + 1) * 10
	for s in reversed(symbols):
		if n >= prefix[s]:
			value = float(n) / prefix[s]
			return '%03.1f%s' % (value, s)
	return "%sB" % n