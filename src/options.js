import {TAG_MAKERNOTE, TAG_USERCOMMENT} from './tags.js'
import {TAG_IFD_EXIF, TAG_IFD_GPS, TAG_IFD_INTEROP} from './tags.js'
import {TAG_GPS_LATREF, TAG_GPS_LAT, TAG_GPS_LONREF, TAG_GPS_LON} from './tags.js'
//import {TAG_XMP, TAG_IPTC, TAG_ICC} from './tags.js'
import {tagKeys} from './tags.js'
import * as platform from './util/platform.js'


export const readerProps = [
	'wholeFile',
	'firstChunkSize',
	'firstChunkSizeNode',
	'firstChunkSizeBrowser',
	'chunkSize',
	'chunkLimit',
]

export const segments = ['jfif', 'tiff', 'xmp', 'icc', 'iptc']
// WARNING: this order is necessary for correctly assigning pick tags.
export const tiffBlocks = ['thumbnail', 'interop', 'gps', 'exif', 'ifd0']
export const segmentsAndBlocks = [...segments, ...tiffBlocks]
export const tiffExtractables = ['makerNote', 'userComment']
export const formatters = ['translateKeys', 'translateValues', 'reviveValues', 'sanitize']
export const allFormatters = [...formatters, 'mergeOutput']

class SubOptions {

	enabled = false
	skip = new Set
	pick = new Set
	deps = new Set // tags required by other blocks or segments (IFD pointers, makernotes)
	translateKeys   = false
	translateValues = false
	reviveValues    = false
	
	get needed() {
		return this.enabled
			|| this.deps.size > 0
	}

	constructor(key, defaultValue, userValue, parent) {
		this.key = key
		this.enabled = defaultValue

		this.applyFormatters(parent)

		this.canBeFiltered = tiffBlocks.includes(key)
		if (this.canBeFiltered) {
			this.dict = tagKeys[key]
			// todo: cache this, and preferably move to dicts files/object/class
			this.dictKeys   = Object.keys(this.dict)
			this.dictValues = Object.values(this.dict)
		}

		if (userValue !== undefined) {
			if (Array.isArray(userValue)) {
				this.enabled = true
				if (this.canBeFiltered && userValue.length > 0)
					this.translateTagSet(userValue, this.pick)
			} else if (typeof userValue === 'object') {
				this.enabled = true
				if (this.canBeFiltered) {
					let {pick, skip} = userValue
					if (pick && pick.length > 0) this.translateTagSet(pick, this.pick)
					if (skip && skip.length > 0) this.translateTagSet(skip, this.skip)
				}
				this.applyFormatters(userValue)
			} else if (userValue === true || userValue === false) {
				this.enabled = userValue
			} else {
				throw new Error(`Invalid options argument: ${userValue}`)
			}
		}
	}

	applyFormatters(origin) {
		let {translateKeys, translateValues, reviveValues} = origin
		if (translateKeys   !== undefined) this.translateKeys   = translateKeys
		if (translateValues !== undefined) this.translateValues = translateValues
		if (reviveValues    !== undefined) this.reviveValues    = reviveValues
	}

	translateTagSet(inputArray, outputSet) {
		let {dictKeys, dictValues} = this
		for (let tag of inputArray) {
			if (typeof tag === 'string') {
				let index = dictValues.indexOf(tag)
				if (index === -1) index = dictKeys.indexOf(Number(tag))
				if (index !== -1) outputSet.add(Number(dictKeys[index]))
			} else {
				outputSet.add(tag)
			}
		}
	}

	finalizeFilters() {
		if (!this.enabled && this.deps.size > 0) {
			this.enabled = true
			addToSet(this.pick, this.deps)
		} else if (this.enabled && this.pick.size > 0) {
			addToSet(this.pick, this.deps)
		}
	}

}



export class Options {

	// APP Segments
	static jfif = false
	static tiff = true
	static xmp = false
	static icc = false
	static iptc = false

	// TIFF BLOCKS
	static ifd0 = true
	static exif = true
	static gps = true
	static interop = false
	static thumbnail = false

	// Notable TIFF tags
	static makerNote = false
	static userComment = false

	// FILTERS

	// Array of tags that will be excluded when parsing.
	// Saves performance because the tags aren't read at all and thus not further processed.
	// Cannot be used along with 'pick' array.
	static skip = []
	// Array of the only tags that will be parsed. Those that are not specified will be ignored.
	// Extremely saves performance because only selected few tags are processed.
	// Useful for extracting few informations from a batch of many photos.
	// Cannot be used along with 'skip' array.
	static pick = []

	// OUTPUT FORMATTERS

	static translateKeys = true
	static translateValues = true
	static reviveValues = true
	// Removes IFD pointers and other artifacts (useless for user) from output.
	static sanitize = true
	// Changes output format by merging all segments and blocks into single object.
	// NOTE = Causes loss of thumbnail EXIF data.
	static mergeOutput = true

	// CHUNKED READER

	// true      - forces reading the whole file
	// undefined - allows reading additional chunks of size `chunkSize` (chunked mode)
	// false     - does not allow reading additional chunks beyond `firstChunkSize` (chunked mode)
	static wholeFile = undefined
	// TODO
	static firstChunkSize = undefined
	// Size of the chunk that can be scanned for EXIF. Used by node.js.
	static firstChunkSizeNode = 512
	// In browser its sometimes better to download larger chunk in hope that it contains the
	// whole EXIF (and not just its begining like in case of firstChunkSizeNode) in prevetion
	// of additional loading and fetching.
	static firstChunkSizeBrowser = 65536 // 64kb
	// TODO
	static chunkSize = 65536 // 64kb
	// Maximum ammount of additional chunks allowed to read in chunk mode.
	// If the requested segments aren't parsed within N chunks (64*10 = 640kb) they probably aren't in the file.
	static chunkLimit = 10

	constructor(userOptions) {
		if (userOptions === true)
			this.setupFromTrue()
		else if (typeof userOptions === 'object')
			this.setupFromObject(userOptions)
		else if (userOptions === undefined)
			this.setupFromUndefined()
		else
			throw new Error(`Invalid options argument ${userOptions}`)
		if (this.firstChunkSize === undefined)
			this.firstChunkSize = platform.browser ? this.firstChunkSizeBrowser : this.firstChunkSizeNode
	}

	setupFromUndefined() {
		let key
		let defaults = this.constructor
		for (key of readerProps)       this[key] = defaults[key]
		for (key of allFormatters)     this[key] = defaults[key]
		for (key of tiffExtractables)  this[key] = defaults[key]
		for (key of segmentsAndBlocks) this[key] = new SubOptions(key, defaults[key], undefined, this)
	}

	setupFromTrue() {
		let key
		let defaults = this.constructor
		for (key of readerProps)       this[key] = defaults[key]
		for (key of allFormatters)     this[key] = defaults[key]
		for (key of tiffExtractables)  this[key] = true
		for (key of segmentsAndBlocks) this[key] = new SubOptions(key, true, undefined, this)
	}

	setupFromObject(userOptions) {
		let key
		let defaults = this.constructor
		for (key of readerProps)       this[key] = getDefined(userOptions[key], defaults[key])
		for (key of allFormatters)     this[key] = getDefined(userOptions[key], defaults[key])
		for (key of tiffExtractables)  this[key] = getDefined(userOptions[key], defaults[key])
		for (key of segments)          this[key] = new SubOptions(key, defaults[key], userOptions[key], this)
		for (key of tiffBlocks)        this[key] = new SubOptions(key, defaults[key], userOptions[key], this.tiff)
		this.setupGlobalFilters(userOptions.pick, userOptions.skip, tiffBlocks, segmentsAndBlocks)
		if (userOptions.tiff === true)
			this.batchEnableWithBool(tiffBlocks, true)
		else if (userOptions.tiff === false)
			this.batchEnableWithUserValue(tiffBlocks, userOptions)
		else if (Array.isArray(userOptions.tiff))
			this.setupGlobalFilters(userOptions.tiff, undefined, tiffBlocks)
		else if (typeof userOptions.tiff === 'object')
			this.setupGlobalFilters(userOptions.tiff.pick, userOptions.tiff.skip, tiffBlocks)
		// thumbnail contains the same tags as ifd0. they're not necessary when `mergeOutput`
		if (this.mergeOutput) this.thumbnail.enabled = false
		// translate global pick/skip tags & copy them to local segment/block settings
		// handle the tiff->ifd0->exif->makernote pick dependency tree.
		// this also adds picks to blocks & segments to efficiently parse through tiff.
		this.traverseTiffDependencyTree()
	}

	batchEnableWithBool(keys, value) {
		for (let key of keys)
			this[key].enabled = value
	}

	batchEnableWithUserValue(keys, userOptions) {
		for (let key of keys) {
			let userOption = userOptions[key]
			this[key].enabled = userOption !== false && userOption !== undefined
		}
	}

	setupGlobalFilters(pick, skip, dictKeys, scopedBlocks = dictKeys) {
		if (pick && pick.length) {
			// if we're only picking, we can safely disable all other blocks and segments
			for (let key of scopedBlocks)
				this[key].enabled = false
			let entries = findScopesForGlobalTagArray(pick, dictKeys)
			for (let [key, tags] of entries) {
				addToSet(this[key].pick, tags)
				// the blocks of tags from global picks are the only blocks we'll parse.
				this[key].enabled = true
			}
		} else if (skip && skip.length) {
			let entries = findScopesForGlobalTagArray(skip, dictKeys)
			for (let [segKey, tags] of entries)
				addToSet(this[segKey].skip, tags)
		}
	}

	// INVESTIGATE: move this to Tiff Segment parser
	traverseTiffDependencyTree() {
		let {ifd0, exif, gps, interop} = this
		if (this.makerNote)   exif.deps.add(TAG_MAKERNOTE)
		else                  exif.skip.add(TAG_MAKERNOTE)
		if (this.userComment) exif.deps.add(TAG_USERCOMMENT)
		else                  exif.skip.add(TAG_USERCOMMENT)
		// interop pointer can be often found in EXIF besides IFD0.
		if (interop.needed) {
			exif.deps.add(TAG_IFD_INTEROP)
			ifd0.deps.add(TAG_IFD_INTEROP)
		}
		// exif needs to go after interop. Exif may be needed for interop, and then ifd0 for exif
		if (exif.needed)      ifd0.deps.add(TAG_IFD_EXIF)
		if (gps.needed)       ifd0.deps.add(TAG_IFD_GPS)
		this.tiff.enabled = tiffBlocks.some(key => this[key].enabled === true)
						|| this.makerNote
						|| this.userComment
		// reenable all the blocks with pick or deps and lock in deps into picks if needed.
		for (let key of tiffBlocks) this[key].finalizeFilters()
	}

}

function findScopesForGlobalTagArray(tagArray, dictKeys) {
	let entries = []
	//dictKeys = Object.keys(tagKeys)
	for (let key of dictKeys) {
		let dict = tagKeys[key]
		let scopedTags = []
		for (let [tagKey, tagName] of Object.entries(dict))
			if (tagArray.includes(tagKey) || tagArray.includes(tagName))
				scopedTags.push(Number(tagKey))
		if (scopedTags.length)
			entries.push([key, scopedTags])
	}
	return entries
}

function getDefined(arg1, arg2) {
	if (arg1 !== undefined) return arg1
	if (arg2 !== undefined) return arg2
}

function addToSet(target, source) {
	for (let item of source)
		target.add(item)
}

export let gpsOnlyOptions = {
	ifd0: false,
	exif: false,
	gps: [TAG_GPS_LATREF, TAG_GPS_LAT, TAG_GPS_LONREF, TAG_GPS_LON],
	interop: false,
	thumbnail: false,
	// turning off all unnecessary steps and transformation to get the needed data ASAP
	sanitize: false,
	reviveValues: true,
	translateKeys: false,
	translateValues: false,
	mergeOutput: false,
}